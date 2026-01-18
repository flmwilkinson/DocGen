"""
DocGen.AI Python Sandbox Service

Executes Python code in a sandboxed environment for data analysis and computation.
"""

import os
import sys
import io
import uuid
import time
import traceback
import tempfile
import shutil
from typing import Optional, Dict, Any, List
from contextlib import redirect_stdout, redirect_stderr

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

app = FastAPI(
    title="DocGen.AI Python Sandbox",
    description="Sandboxed Python execution service",
    version="0.1.0",
)

# Add CORS middleware to allow requests from the web app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
SANDBOX_DIR = os.environ.get("SANDBOX_DIR", "/tmp/sandbox")
MAX_EXECUTION_TIME = int(os.environ.get("SANDBOX_TIMEOUT_SEC", "60"))
MAX_OUTPUT_SIZE = 1024 * 1024  # 1MB

# Ensure sandbox directory exists
os.makedirs(SANDBOX_DIR, exist_ok=True)


class ExecuteRequest(BaseModel):
    code: str
    timeout_sec: int = 60
    attached_files: Optional[List[str]] = None
    execution_id: Optional[str] = None  # Optional: use existing execution directory


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    execution_time_ms: int
    generated_files: List[Dict[str, Any]]
    structured_result: Optional[Dict[str, Any]] = None


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "sandbox-python"}


@app.post("/execute", response_model=ExecuteResponse)
async def execute_code(request: ExecuteRequest):
    """
    Execute Python code in a sandboxed environment.
    
    The code has access to:
    - pandas, numpy, scipy for data analysis
    - matplotlib, seaborn, plotly for visualization
    - Standard Python libraries
    
    Generated files (plots, CSVs) are saved and returned.
    """
    execution_id = request.execution_id or str(uuid.uuid4())
    work_dir = os.path.join(SANDBOX_DIR, execution_id)
    
    try:
        # Create isolated working directory
        os.makedirs(work_dir, exist_ok=True)
        
        # Prepare execution environment
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        
        # Prepare globals for execution
        exec_globals = {
            "__builtins__": __builtins__,
            "__name__": "__main__",
            "__doc__": None,
            "WORK_DIR": work_dir,
            "OUTPUT_DIR": work_dir,
        }
        
        # Add safe imports
        try:
            import pandas as pd
            import numpy as np
            import matplotlib
            matplotlib.use('Agg')  # Non-interactive backend
            import matplotlib.pyplot as plt
            import seaborn as sns
            
            exec_globals.update({
                "pd": pd,
                "np": np,
                "plt": plt,
                "sns": sns,
            })
        except ImportError as e:
            stderr_capture.write(f"Warning: Could not import library: {e}\n")
        
        # Execute code with timeout
        start_time = time.time()
        exit_code = 0
        structured_result = None
        
        try:
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                exec(request.code, exec_globals)
                
                # Check for result variable
                if "_result" in exec_globals:
                    structured_result = exec_globals["_result"]
                    if not isinstance(structured_result, dict):
                        structured_result = {"value": str(structured_result)}
                
                # Save any matplotlib figures
                if "plt" in exec_globals:
                    figs = [plt.figure(i) for i in plt.get_fignums()]
                    for i, fig in enumerate(figs):
                        fig_path = os.path.join(work_dir, f"figure_{i}.png")
                        fig.savefig(fig_path, dpi=150, bbox_inches='tight')
                    plt.close('all')
                    
        except Exception as e:
            exit_code = 1
            stderr_capture.write(f"Execution error: {str(e)}\n")
            stderr_capture.write(traceback.format_exc())
        
        execution_time_ms = int((time.time() - start_time) * 1000)
        
        # Collect generated files
        generated_files = []
        for filename in os.listdir(work_dir):
            file_path = os.path.join(work_dir, filename)
            if os.path.isfile(file_path):
                file_size = os.path.getsize(file_path)
                generated_files.append({
                    "filename": filename,
                    "path": file_path,
                    "size": file_size,
                    "mime_type": get_mime_type(filename),
                })
        
        return ExecuteResponse(
            stdout=stdout_capture.getvalue()[:MAX_OUTPUT_SIZE],
            stderr=stderr_capture.getvalue()[:MAX_OUTPUT_SIZE],
            exit_code=exit_code,
            execution_time_ms=execution_time_ms,
            generated_files=generated_files,
            structured_result=structured_result,
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Cleanup after a delay (allow file downloads)
        # In production, use a background task to clean up
        pass


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    execution_id: str = Form(...),
):
    """Upload a file to be used in code execution"""
    work_dir = os.path.join(SANDBOX_DIR, execution_id)
    os.makedirs(work_dir, exist_ok=True)
    
    file_path = os.path.join(work_dir, file.filename)
    
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    return {"filename": file.filename, "path": file_path, "size": len(content)}


@app.get("/download/{execution_id}/{filename}")
async def download_file(execution_id: str, filename: str):
    """Download a generated file"""
    file_path = os.path.join(SANDBOX_DIR, execution_id, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(
        file_path,
        media_type=get_mime_type(filename),
        filename=filename,
    )


@app.delete("/cleanup/{execution_id}")
async def cleanup_execution(execution_id: str):
    """Clean up files from an execution"""
    work_dir = os.path.join(SANDBOX_DIR, execution_id)
    
    if os.path.exists(work_dir):
        shutil.rmtree(work_dir)
    
    return {"status": "cleaned", "execution_id": execution_id}


class TransferFilesRequest(BaseModel):
    """Request to transfer files to sandbox for code execution"""
    execution_id: str
    files: List[Dict[str, str]]  # List of {path: str, content: str} or {path: str, url: str}


@app.post("/transfer-files")
async def transfer_files(request: TransferFilesRequest):
    """
    Transfer files to the sandbox for use in code execution.
    
    Files can be provided as:
    - Direct content: {"path": "data/file.csv", "content": "a,b,c\\n1,2,3"}
    - URL to fetch: {"path": "data/file.csv", "url": "https://..."}
    
    Files are stored in /data/{path} within the sandbox.
    """
    import requests
    import base64
    
    work_dir = os.path.join(SANDBOX_DIR, request.execution_id)
    data_dir = os.path.join(work_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    transferred = []
    errors = []
    
    for file_info in request.files:
        file_path = file_info.get("path", "")
        if not file_path:
            continue
            
        # Create subdirectories if needed
        full_path = os.path.join(data_dir, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        try:
            if "content" in file_info:
                # Direct content - may be base64 encoded for binary files
                content = file_info["content"]
                if file_info.get("encoding") == "base64":
                    content = base64.b64decode(content)
                    with open(full_path, "wb") as f:
                        f.write(content)
                else:
                    with open(full_path, "w", encoding="utf-8") as f:
                        f.write(content)
                        
            elif "url" in file_info:
                # Fetch from URL
                url = file_info["url"]
                response = requests.get(url, timeout=30)
                response.raise_for_status()
                
                # Detect if binary
                content_type = response.headers.get("content-type", "")
                if "text" in content_type or file_path.endswith(('.csv', '.json', '.txt', '.md')):
                    with open(full_path, "w", encoding="utf-8") as f:
                        f.write(response.text)
                else:
                    with open(full_path, "wb") as f:
                        f.write(response.content)
            else:
                errors.append({"path": file_path, "error": "No content or url provided"})
                continue
                
            transferred.append({
                "path": file_path,
                "full_path": full_path,
                "size": os.path.getsize(full_path)
            })
            
        except Exception as e:
            errors.append({"path": file_path, "error": str(e)})
    
    return {
        "execution_id": request.execution_id,
        "data_dir": data_dir,
        "transferred": transferred,
        "errors": errors
    }


def get_mime_type(filename: str) -> str:
    """Get MIME type from filename"""
    ext = os.path.splitext(filename)[1].lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".pdf": "application/pdf",
        ".csv": "text/csv",
        ".json": "application/json",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".html": "text/html",
    }
    return mime_types.get(ext, "application/octet-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

