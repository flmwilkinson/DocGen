/**
 * ReAct Agent for Chart Generation and Analysis
 * 
 * Implements a proper ReAct workflow for chart blocks:
 * 1. ANALYZE - Inspect data files, understand structure, identify key variables
 * 2. PLAN - Create a plan for which charts/analyses to generate
 * 3. EXECUTE - Generate charts and run statistical analysis
 * 4. PARSE - Extract key facts and statistics from analysis outputs
 * 5. DOCUMENT - Write comprehensive documentation with charts, tables, and narrative
 */

import OpenAI from 'openai';
import {
  getAvailableTools,
  executeTool,
  formatToolResultForDocument,
  ToolContext,
} from './llm-tools';
import { EvidenceBundle } from './evidence-first';

// =============================================================================
// TYPES
// =============================================================================

export interface ChartAgentContext {
  openai: OpenAI;
  projectName: string;
  repoUrl?: string;
  evidenceBundle: EvidenceBundle;
  allFiles: Array<{ path: string; content: string }>;
  dataFiles: Array<{ path: string; content?: string; url?: string }>;
  onThinking?: (step: { type: string; message: string; details?: string }) => void;
}

export interface ChartPlan {
  charts: Array<{
    title: string;
    type: 'histogram' | 'line' | 'scatter' | 'bar' | 'box' | 'heatmap' | 'correlation';
    dataFile: string;
    variables: string[];
    purpose: string;
  }>;
  analyses: Array<{
    purpose: string;
    dataFile: string;
    metrics: string[];
  }>;
  tables: Array<{
    title: string;
    purpose: string;
  }>;
}

export interface ChartAgentResult {
  content: string;
  generatedImages: Array<{ base64: string; mimeType: string; description: string }>;
  executedCode?: string;
  analysisResults?: Record<string, unknown>;
  tables?: Array<{ headers: string[]; rows: string[][]; caption?: string }>;
}

// =============================================================================
// REACT WORKFLOW
// =============================================================================

/**
 * STEP 1: ANALYZE - Inspect data files and understand structure
 * Now includes first 5 rows of sample data so LLM can make informed decisions
 */
async function analyze(
  ctx: ChartAgentContext
): Promise<{ dataSummary: string; availableVariables: Record<string, string[]>; sampleData: Record<string, string> }> {
  ctx.onThinking?.({ type: 'think', message: 'Analyzing data files...', details: 'Inspecting file structure, variables, and sample data' });

  const availableVariables: Record<string, string[]> = {};
  const sampleData: Record<string, string> = {}; // First 5 rows per file
  let dataSummary = '## DATA ANALYSIS\n\n';

  // Helper to extract sample data from file content
  const extractSampleData = (content: string, path: string): string => {
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return 'No data rows found';

    // Get header and first 5 data rows
    const header = lines[0];
    const dataRows = lines.slice(1, 6); // First 5 rows after header

    // Format as a simple table preview
    let preview = `Headers: ${header}\n`;
    preview += `Sample rows (first ${dataRows.length}):\n`;
    dataRows.forEach((row, idx) => {
      // Truncate very long rows
      const truncatedRow = row.length > 200 ? row.slice(0, 200) + '...' : row;
      preview += `  Row ${idx + 1}: ${truncatedRow}\n`;
    });

    return preview;
  };

  // Use data evidence from evidence bundle if available
  if (ctx.evidenceBundle.dataEvidence.length > 0) {
    for (const dataEv of ctx.evidenceBundle.dataEvidence) {
      const columns = dataEv.columns.map(col => col.name);
      const columnTypes = dataEv.columns.map(col => `${col.name}(${col.dtype || 'unknown'})`);
      availableVariables[dataEv.filePath] = columns;

      dataSummary += `### ${dataEv.filePath}\n`;
      dataSummary += `- Rows: ${dataEv.rowCount}\n`;
      dataSummary += `- Columns (${columns.length}): ${columnTypes.slice(0, 15).join(', ')}${columns.length > 15 ? '...' : ''}\n`;
      dataSummary += `- Key metrics: ${dataEv.columns.filter(col =>
        ['amount', 'value', 'price', 'rate', 'score', 'count', 'total'].some(k => col.name.toLowerCase().includes(k))
      ).map(col => col.name).slice(0, 5).join(', ')}\n`;

      // Find the actual file content for sample data
      const matchingFile = ctx.dataFiles.find(f =>
        f.path === dataEv.filePath ||
        f.path.includes(dataEv.filePath) ||
        dataEv.filePath.includes(f.path)
      );

      if (matchingFile?.content) {
        const sample = extractSampleData(matchingFile.content, dataEv.filePath);
        sampleData[dataEv.filePath] = sample;
        dataSummary += `\n**SAMPLE DATA:**\n\`\`\`\n${sample}\`\`\`\n`;
      }
      dataSummary += '\n';
    }
  } else {
    // Fallback: analyze from file content
    for (const file of ctx.dataFiles) {
      if (file.path.endsWith('.csv') && file.content) {
        const lines = file.content.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
          availableVariables[file.path] = headers;

          const sample = extractSampleData(file.content, file.path);
          sampleData[file.path] = sample;

          dataSummary += `### ${file.path}\n`;
          dataSummary += `- Columns: ${headers.slice(0, 15).join(', ')}${headers.length > 15 ? '...' : ''}\n`;
          dataSummary += `\n**SAMPLE DATA:**\n\`\`\`\n${sample}\`\`\`\n\n`;
        }
      }
    }
  }

  console.log(`[ChartAgent] Analyzed ${Object.keys(availableVariables).length} data files with sample data`);

  return { dataSummary, availableVariables, sampleData };
}

/**
 * STEP 2: PLAN - Create a plan for charts and analyses
 */
async function createPlan(
  ctx: ChartAgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  dataSummary: string,
  availableVariables: Record<string, string[]>,
  sampleData: Record<string, string>
): Promise<ChartPlan> {
  ctx.onThinking?.({ type: 'think', message: 'Creating analysis plan...', details: 'Determining which charts and analyses to generate' });
  
  const systemPrompt = `You are a data analysis expert. Your task is to create a comprehensive plan for visualizing and analyzing data.

## AVAILABLE DATA
${dataSummary}

## TASK
${sectionInstructions}

## YOUR JOB
Create a plan for:
1. Which charts to generate (3-6 visualizations showing different aspects)
2. Which statistical analyses to run (mean, median, distributions, correlations, etc.)
3. Which summary tables to create (key statistics, findings)

Return a JSON object with this structure:
{
  "charts": [
    {
      "title": "Chart title",
      "type": "histogram|line|scatter|bar|box|heatmap|correlation",
      "dataFile": "path/to/file.csv",
      "variables": ["var1", "var2"],
      "purpose": "What this chart will show"
    }
  ],
  "analyses": [
    {
      "purpose": "Compute summary statistics",
      "dataFile": "path/to/file.csv",
      "metrics": ["mean", "median", "std", "percentiles"]
    }
  ],
  "tables": [
    {
      "title": "Summary Statistics",
      "purpose": "Present key findings"
    }
  ]
}`;

  const response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create a comprehensive analysis plan for: ${sectionTitle}` },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  try {
    const plan = JSON.parse(response.choices[0]?.message?.content || '{}') as ChartPlan;
    console.log(`[ChartAgent] Plan created: ${plan.charts?.length || 0} charts, ${plan.analyses?.length || 0} analyses, ${plan.tables?.length || 0} tables`);
    return plan;
  } catch (error) {
    console.error('[ChartAgent] Failed to parse plan, using default', error);
    // Default plan: generate a few basic charts
    return {
      charts: Object.keys(availableVariables).slice(0, 3).map((filePath, idx) => ({
        title: `Chart ${idx + 1}`,
        type: 'histogram' as const,
        dataFile: filePath,
        variables: availableVariables[filePath].slice(0, 1),
        purpose: 'Explore data distribution',
      })),
      analyses: [],
      tables: [],
    };
  }
}

/**
 * STEP 3: EXECUTE - Generate charts and run analyses
 * Now includes sampleData so LLM can see actual data values before generating code
 */
async function execute(
  ctx: ChartAgentContext,
  plan: ChartPlan,
  sampleData: Record<string, string>
): Promise<{
  charts: Array<{ base64: string; mimeType: string; description: string; code: string }>;
  analyses: Array<{ result: Record<string, unknown>; stdout: string }>;
}> {
  ctx.onThinking?.({ type: 'tool', message: 'Executing plan...', details: `Generating ${plan.charts.length} charts and ${plan.analyses.length} analyses` });

  const generatedCharts: Array<{ base64: string; mimeType: string; description: string; code: string }> = [];
  const analysisResults: Array<{ result: Record<string, unknown>; stdout: string }> = [];

  const toolContext: ToolContext = {
    projectName: ctx.projectName,
    repoUrl: ctx.repoUrl,
    dataFiles: ctx.dataFiles,
  };

  // Execute charts with retry logic
  const MAX_CHART_RETRIES = 2;

  for (const chartPlan of plan.charts || []) {
    let lastError: string | null = null;
    let pythonCode = '';

    for (let attempt = 0; attempt <= MAX_CHART_RETRIES; attempt++) {
      try {
        const attemptLabel = attempt > 0 ? ` (retry ${attempt}/${MAX_CHART_RETRIES})` : '';
        ctx.onThinking?.({ type: 'tool', message: `Generating chart: ${chartPlan.title}${attemptLabel}`, details: chartPlan.purpose });

        // Build context about available columns for this specific file
        const fileColumns = ctx.evidenceBundle.dataEvidence.find(de =>
          de.filePath.includes(chartPlan.dataFile) || chartPlan.dataFile.includes(de.filePath)
        );
        const actualColumns = fileColumns?.columns.map(c => c.name) || chartPlan.variables;
        const numericColumns = fileColumns?.columns.filter(c =>
          ['int', 'float', 'number', 'numeric'].some(t => c.dtype?.toLowerCase().includes(t))
        ).map(c => c.name) || [];

        // Get sample data for this specific file
        const fileSampleData = sampleData[chartPlan.dataFile] ||
          Object.entries(sampleData).find(([path]) =>
            path.includes(chartPlan.dataFile) || chartPlan.dataFile.includes(path)
          )?.[1] || 'No sample data available';

        // Build error context for retries
        const errorContext = lastError ? `
## PREVIOUS ATTEMPT FAILED
The previous code failed with this error:
\`\`\`
${lastError}
\`\`\`

**Fix the code to handle this error.** Common fixes:
- If "masked_array" or "All-NaN": The data has no valid values after filtering. Check if data exists first with len(df.dropna()) > 0
- If "KeyError": Use ONLY columns from this exact list: ${actualColumns.join(', ')}
- If type conversion error: Use pd.to_numeric(df[col], errors='coerce') before plotting
- If empty data: Add a check like "if len(valid_data) > 0:" before plotting

` : '';

        // Generate Python code for the chart
        const chartCodePrompt = `Generate Python matplotlib code to create a ${chartPlan.type} chart.

Requirements:
- Chart title: "${chartPlan.title}"
- Data file: ${chartPlan.dataFile}
- Variables to plot: ${chartPlan.variables.join(', ')}
- Purpose: ${chartPlan.purpose}

## ACTUAL AVAILABLE COLUMNS
These are the EXACT column names in the file (use only these):
${actualColumns.slice(0, 30).join(', ')}
${numericColumns.length > 0 ? `\nNumeric columns (safe for math): ${numericColumns.slice(0, 20).join(', ')}` : ''}

## ACTUAL SAMPLE DATA (First 5 rows)
Look at this data to understand values, ranges, and what plots make sense:
\`\`\`
${fileSampleData}
\`\`\`

**IMPORTANT**: Use this sample data to:
1. Choose appropriate chart types (don't use scatter if data is categorical)
2. Set appropriate axis ranges and labels
3. Avoid plots that don't make sense for this data structure
4. Use ONLY column names that appear in the headers above
${errorContext}
**CRITICAL**: Use the load_data() helper function to load the file. The helper is already available in the sandbox.

**DEFENSIVE CODING**: Always check data validity before plotting:
\`\`\`python
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

# Load data using the helper function
df = load_data('${chartPlan.dataFile}')

# ALWAYS print info for debugging
print("Columns:", df.columns.tolist())
print("Shape:", df.shape)
print("Dtypes:", df.dtypes.to_dict())

# Get numeric columns only
numeric_df = df.select_dtypes(include=[np.number])
print("Numeric columns:", numeric_df.columns.tolist())

# Example: Safe histogram
if len(numeric_df.columns) > 0:
    col = numeric_df.columns[0]
    valid_data = numeric_df[col].dropna()
    if len(valid_data) > 0:
        plt.figure(figsize=(10, 6))
        plt.hist(valid_data, bins=30, edgecolor='black')
        plt.title('${chartPlan.title}')
        plt.xlabel(col)
        plt.ylabel('Frequency')
        plt.tight_layout()
    else:
        print(f"No valid data in {col}")
else:
    print("No numeric columns found")
\`\`\`

Return ONLY the Python code, no explanations. Make sure to use the EXACT column names from the ACTUAL AVAILABLE COLUMNS list above.`;

        const codeResponse = await ctx.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: `You are a Python data visualization expert. Generate clean, working matplotlib code.

CRITICAL - PREFER SIMPLE, RELIABLE CHART TYPES:
- PREFER: histograms (plt.hist), bar charts (plt.bar), line plots (plt.plot)
- AVOID: seaborn grouped plots, boxplots, scatter with hue, violin plots
- AVOID: any chart type that requires grouping or categorical axes
- If you must use seaborn, use simple versions: sns.histplot, sns.lineplot
- ALWAYS convert data to Python lists with .tolist() before plotting to avoid numpy masked array issues

CRITICAL DATA HANDLING RULES - ALWAYS FOLLOW THESE:
1. ALWAYS check if data exists before plotting: if len(df) > 0 and len(df.dropna()) > 0
2. ALWAYS use .select_dtypes(include=[np.number]) to get only numeric columns
3. ALWAYS use .dropna() before any calculation or plotting
4. NEVER assume column names - use ONLY the exact names provided
5. Convert numpy arrays to lists: values = df[col].dropna().tolist()
6. For correlation: use df.select_dtypes(include=[np.number]).dropna().corr()
7. ALWAYS wrap plotting code in validity checks
8. Print diagnostic info (shape, columns, dtypes) at the start
9. Use plt.subplots() style for figures: fig, ax = plt.subplots()
10. NEVER use plt.show() - charts are saved automatically` },
            { role: 'user', content: chartCodePrompt },
          ],
          temperature: 0.3,
          max_tokens: 1200,
        });

        pythonCode = codeResponse.choices[0]?.message?.content?.trim() || '';

        if (pythonCode) {
          // Execute the chart
          const toolResult = await executeTool('generate_chart', {
            python_code: pythonCode,
            description: chartPlan.title,
          }, toolContext);

          // Check if execution failed
          if (!toolResult.success) {
            lastError = toolResult.error || 'Unknown execution error';
            console.warn(`[ChartAgent] Chart "${chartPlan.title}" attempt ${attempt + 1} failed:`, lastError);

            if (attempt < MAX_CHART_RETRIES) {
              ctx.onThinking?.({ type: 'think', message: `Chart failed, retrying with error feedback...`, details: lastError.slice(0, 100) });
              continue; // Retry with error context
            }
            // Final attempt failed
            console.error(`[ChartAgent] Chart "${chartPlan.title}" failed after ${MAX_CHART_RETRIES + 1} attempts`);
            break;
          }

          const formattedResult = formatToolResultForDocument('generate_chart', toolResult);

          console.log(`[ChartAgent] 📊 formattedResult for "${chartPlan.title}":`, {
            hasGeneratedImage: !!formattedResult.generatedImage,
            generatedImagesCount: formattedResult.generatedImages?.length || 0,
            imageBase64Length: formattedResult.generatedImage?.base64?.length || 0,
          });

          if (formattedResult.generatedImage) {
            const charts = formattedResult.generatedImages || [formattedResult.generatedImage];
            charts.forEach((img, idx) => {
              generatedCharts.push({
                base64: img.base64,
                mimeType: img.mimeType,
                description: idx === 0 ? chartPlan.title : `${chartPlan.title} (${idx + 1})`,
                code: pythonCode,
              });
              console.log(`[ChartAgent] ✅ Added chart "${chartPlan.title}" to collection. Total: ${generatedCharts.length}`);
            });
            ctx.onThinking?.({ type: 'complete', message: `✅ Chart generated: ${chartPlan.title}${attempt > 0 ? ` (after ${attempt} retry)` : ''}` });
            break; // Success, exit retry loop
          } else {
            // No image generated but no error - treat as failure
            lastError = 'Chart generated but no image was produced. Data may be empty after filtering.';
            if (attempt < MAX_CHART_RETRIES) {
              continue;
            }
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[ChartAgent] Exception generating chart "${chartPlan.title}" attempt ${attempt + 1}:`, error);
        if (attempt >= MAX_CHART_RETRIES) {
          break;
        }
      }
    }

    // FALLBACK: If all LLM attempts failed, try a bulletproof template
    if (generatedCharts.length === 0 || !generatedCharts.some(c => c.description === chartPlan.title)) {
      try {
        ctx.onThinking?.({ type: 'tool', message: `Trying fallback chart: ${chartPlan.title}`, details: 'Using bulletproof template' });

        // Create a guaranteed-to-work chart code with extensive diagnostics
        const fallbackCode = `
import matplotlib
matplotlib.use('Agg')  # Force non-interactive backend FIRST
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
import os
import warnings
warnings.filterwarnings('ignore')

print("="*60)
print("DIAGNOSTIC OUTPUT - CHART FALLBACK")
print("="*60)

# List all available files
print("\\nAvailable files in DATA_DIR:")
for root, dirs, files in os.walk(DATA_DIR):
    for f in files:
        full_path = os.path.join(root, f)
        size = os.path.getsize(full_path)
        print(f"  {os.path.relpath(full_path, DATA_DIR)}: {size} bytes")

# Try to find and load the data file
target_file = '${chartPlan.dataFile}'
print(f"\\nLooking for: {target_file}")

# Try exact path first
exact_path = os.path.join(DATA_DIR, target_file)
found_path = None

if os.path.exists(exact_path):
    found_path = exact_path
else:
    # Search for the file by basename
    basename = os.path.basename(target_file)
    for root, dirs, files in os.walk(DATA_DIR):
        if basename in files:
            found_path = os.path.join(root, basename)
            break

if found_path:
    print(f"Found file at: {found_path}")
    print(f"File size: {os.path.getsize(found_path)} bytes")

    # Read first few bytes to check encoding
    with open(found_path, 'rb') as f:
        first_bytes = f.read(200)
        print(f"First 200 bytes (raw): {first_bytes[:100]}")

    # Try to load as CSV with different encodings
    df = None
    for encoding in ['utf-8', 'latin-1', 'cp1252']:
        try:
            df = pd.read_csv(found_path, encoding=encoding, nrows=100)
            print(f"\\nLoaded with encoding: {encoding}")
            break
        except Exception as e:
            print(f"Failed with {encoding}: {e}")

    if df is not None:
        print(f"\\nDataFrame shape: {df.shape}")
        print(f"Columns: {df.columns.tolist()}")
        print(f"\\nData types:\\n{df.dtypes}")
        print(f"\\nFirst 3 rows:\\n{df.head(3)}")
        print(f"\\nNull counts:\\n{df.isnull().sum()}")

        # Find numeric columns
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        print(f"\\nNumeric columns: {numeric_cols}")

        # Try to create a chart from the FIRST numeric column with data
        chart_created = False
        for col in numeric_cols:
            valid_data = df[col].dropna()
            print(f"\\nColumn '{col}': {len(valid_data)} non-null values")

            if len(valid_data) >= 3:
                # Convert to Python list to avoid ANY numpy masking issues
                values = valid_data.tolist()

                # Create fresh figure
                fig, ax = plt.subplots(figsize=(10, 6))

                # Plot histogram using ax directly (not plt.hist)
                ax.hist(values, bins=min(30, max(5, len(values)//3)),
                       color='#4CAF50', edgecolor='white', alpha=0.8)
                ax.set_title('${chartPlan.title}', fontsize=14, color='white')
                ax.set_xlabel(col, fontsize=12)
                ax.set_ylabel('Frequency', fontsize=12)

                fig.tight_layout()
                chart_created = True
                print(f"SUCCESS: Created histogram for '{col}'")
                break

        if not chart_created:
            # Try categorical
            for col in df.columns[:5]:
                try:
                    counts = df[col].value_counts().head(8)
                    if len(counts) >= 2:
                        fig, ax = plt.subplots(figsize=(10, 6))
                        bars = ax.bar(range(len(counts)), counts.values,
                                     color='#2196F3', edgecolor='white', alpha=0.8)
                        ax.set_xticks(range(len(counts)))
                        ax.set_xticklabels([str(x)[:15] for x in counts.index],
                                          rotation=45, ha='right')
                        ax.set_title('${chartPlan.title}', fontsize=14, color='white')
                        ax.set_xlabel(col, fontsize=12)
                        ax.set_ylabel('Count', fontsize=12)
                        fig.tight_layout()
                        chart_created = True
                        print(f"SUCCESS: Created bar chart for '{col}'")
                        break
                except Exception as e:
                    print(f"Categorical failed for '{col}': {e}")

        if not chart_created:
            print("ERROR: No plottable columns found")
            # Create a placeholder chart
            fig, ax = plt.subplots(figsize=(10, 6))
            ax.text(0.5, 0.5, 'No valid data for visualization',
                   ha='center', va='center', fontsize=16, color='white')
            ax.set_title('${chartPlan.title}', fontsize=14, color='white')
            ax.axis('off')
            fig.tight_layout()
    else:
        print("ERROR: Could not load CSV with any encoding")
else:
    print(f"ERROR: File not found: {target_file}")
    # Create error placeholder
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.text(0.5, 0.5, 'Data file not found', ha='center', va='center',
           fontsize=16, color='white')
    ax.set_title('${chartPlan.title}', fontsize=14, color='white')
    ax.axis('off')
    fig.tight_layout()

print("\\n" + "="*60)
print("END DIAGNOSTIC OUTPUT")
print("="*60)
`;

        const fallbackResult = await executeTool('generate_chart', {
          python_code: fallbackCode,
          description: chartPlan.title,
        }, toolContext);

        if (fallbackResult.success) {
          const formattedResult = formatToolResultForDocument('generate_chart', fallbackResult);
          if (formattedResult.generatedImage) {
            const charts = formattedResult.generatedImages || [formattedResult.generatedImage];
            charts.forEach((img, idx) => {
              generatedCharts.push({
                base64: img.base64,
                mimeType: img.mimeType,
                description: idx === 0 ? chartPlan.title : `${chartPlan.title} (${idx + 1})`,
                code: fallbackCode,
              });
            });
            ctx.onThinking?.({ type: 'complete', message: `✅ Chart generated with fallback: ${chartPlan.title}` });
          }
        } else {
          console.error(`[ChartAgent] Even fallback failed for "${chartPlan.title}":`, fallbackResult.error);
        }
      } catch (fallbackError) {
        console.error(`[ChartAgent] Fallback exception for "${chartPlan.title}":`, fallbackError);
      }
    }
  }

  // Execute analyses
  for (const analysisPlan of plan.analyses || []) {
    try {
      ctx.onThinking?.({ type: 'tool', message: `Running analysis: ${analysisPlan.purpose}`, details: analysisPlan.metrics.join(', ') });
      
      // Generate Python code for analysis
      const analysisCodePrompt = `Generate Python code to compute ${analysisPlan.purpose}.

Requirements:
- Data file: ${analysisPlan.dataFile}
- Metrics to compute: ${analysisPlan.metrics.join(', ')}
- Store results in _result variable as a dictionary

Use the load_data() helper function:
df = load_data('${analysisPlan.dataFile}')

Return ONLY the Python code, no explanations.`;

      const codeResponse = await ctx.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are a Python data analysis expert. Generate clean, working pandas/numpy code.

CRITICAL DATA HANDLING RULES:
- ALWAYS handle missing values with .dropna() or .fillna() before calculations
- Use .select_dtypes(include=[np.number]) for numeric operations
- Use pd.to_numeric(col, errors='coerce') for type conversions
- Check column types with df.dtypes before numeric operations
- Never compute mean/std/corr on string columns` },
          { role: 'user', content: analysisCodePrompt },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });

      const pythonCode = codeResponse.choices[0]?.message?.content?.trim() || '';
      
      if (pythonCode) {
        const toolResult = await executeTool('execute_python_analysis', {
          python_code: pythonCode,
          purpose: analysisPlan.purpose,
        }, toolContext);
        
        if (toolResult.success && toolResult.result) {
          const result = toolResult.result as any;
          analysisResults.push({
            result: result.structuredResult || result,
            stdout: result.stdout || '',
          });
          ctx.onThinking?.({ type: 'complete', message: `✅ Analysis complete: ${analysisPlan.purpose}` });
        }
      }
    } catch (error) {
      console.error(`[ChartAgent] Failed to run analysis "${analysisPlan.purpose}":`, error);
    }
  }
  
  console.log(`[ChartAgent] 📊 Execute complete: ${generatedCharts.length} charts, ${analysisResults.length} analyses`);
  console.log(`[ChartAgent] 📊 Charts:`, generatedCharts.map(c => ({
    description: c.description,
    base64Length: c.base64?.length || 0,
    mimeType: c.mimeType,
  })));

  return { charts: generatedCharts, analyses: analysisResults };
}

/**
 * STEP 4: PARSE - Extract key facts from analysis results
 */
function parse(
  analysisResults: Array<{ result: Record<string, unknown>; stdout: string }>
): { keyFacts: string; statistics: Record<string, unknown> } {
  const statistics: Record<string, unknown> = {};
  const keyFacts: string[] = [];
  
  for (const analysis of analysisResults) {
    if (analysis.result) {
      Object.assign(statistics, analysis.result);
      
      // Extract key facts
      for (const [key, value] of Object.entries(analysis.result)) {
        if (typeof value === 'number') {
          keyFacts.push(`${key}: ${value.toFixed(2)}`);
        } else if (typeof value === 'object' && value !== null) {
          keyFacts.push(`${key}: ${JSON.stringify(value)}`);
        }
      }
    }
    
    if (analysis.stdout) {
      // Extract numbers from stdout
      const numberMatches = analysis.stdout.match(/\d+\.?\d*/g);
      if (numberMatches) {
        keyFacts.push(...numberMatches.slice(0, 5));
      }
    }
  }
  
  return {
    keyFacts: keyFacts.join(', '),
    statistics,
  };
}

/**
 * STEP 5: DOCUMENT - Write comprehensive documentation
 */
async function document(
  ctx: ChartAgentContext,
  sectionTitle: string,
  sectionInstructions: string,
  plan: ChartPlan,
  charts: Array<{ base64: string; mimeType: string; description: string; code: string }>,
  analysisResults: Array<{ result: Record<string, unknown>; stdout: string }>,
  keyFacts: string,
  statistics: Record<string, unknown>
): Promise<{ content: string; tables: Array<{ headers: string[]; rows: string[][]; caption?: string }> }> {
  ctx.onThinking?.({ type: 'draft', message: 'Writing documentation...', details: 'Combining charts, analysis, and narrative' });
  
  // Create summary tables from statistics
  const tables: Array<{ headers: string[]; rows: string[][]; caption?: string }> = [];
  
  if (Object.keys(statistics).length > 0) {
    // Create a summary statistics table
    const statEntries = Object.entries(statistics);
    if (statEntries.length > 0) {
      const headers = ['Metric', 'Value'];
      const rows = statEntries.map(([key, value]) => [
        key,
        typeof value === 'number' ? value.toFixed(4) : String(value),
      ]);
      tables.push({
        headers,
        rows,
        caption: 'Summary Statistics',
      });
    }
  }
  
  // Generate narrative
  const chartDescriptions = charts.map((chart, idx) => 
    `Chart ${idx + 1}: ${chart.description}`
  ).join('\n');
  
  const analysisSummary = analysisResults.map((analysis, idx) => {
    const resultStr = JSON.stringify(analysis.result, null, 2).slice(0, 200);
    return `Analysis ${idx + 1}: ${resultStr}...`;
  }).join('\n');
  
  const narrativePrompt = `Write comprehensive documentation for "${sectionTitle}".

## REQUIREMENTS
${sectionInstructions}

## CHARTS GENERATED
${chartDescriptions}

## ANALYSIS RESULTS
${keyFacts ? `Key Facts: ${keyFacts}` : ''}
${analysisSummary ? `\n${analysisSummary}` : ''}

## YOUR TASK
Write comprehensive documentation (4-8 paragraphs) that:
1. Describes what each chart shows
2. References the statistical findings
3. Explains key insights and patterns
4. Be specific about data sources and metrics

## CRITICAL: CHART PLACEMENT
You MUST place charts inline within your narrative where they are most relevant. Use these placeholders:
${charts.map((chart, idx) => `- [CHART:${idx}] - Place this where you discuss "${chart.description}"`).join('\n')}

For example, if discussing outstanding amounts, write:
"The distribution of outstanding amounts reveals important patterns. [CHART:0] shows that most accounts fall within the $0-$50,000 range..."

Place each chart immediately after the sentence where you first mention what it shows. DO NOT put all charts at the end.`;

  const response = await ctx.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a documentation expert. Write clear, comprehensive documentation that references specific charts, statistics, and findings.' },
      { role: 'user', content: narrativePrompt },
    ],
    temperature: 0.3,
    max_tokens: 800,
  });
  
  let content = response.choices[0]?.message?.content || '';
  
  // Replace chart placeholders with actual chart markers that the UI can parse
  // Format: [CHART:0] becomes a special marker that includes chart index and code
  charts.forEach((chart, idx) => {
    const placeholder = new RegExp(`\\[CHART:${idx}\\]`, 'gi');
    // Replace with a marker that includes chart index and will be processed by UI
    // We'll use a special format: <!--CHART_START:index:description-->...<!--CHART_END:index-->
    content = content.replace(placeholder, `<!--CHART_START:${idx}:${chart.description.replace(/[<>]/g, '')}-->`);
  });
  
  // If LLM didn't use placeholders, insert charts at natural break points
  // Find paragraph breaks and insert charts there
  if (!content.includes('CHART_START')) {
    const paragraphs = content.split(/\n\n+/);
    const chartInsertions: Array<{ index: number; chartIdx: number }> = [];
    
    charts.forEach((chart, idx) => {
      // Try to find a paragraph that mentions something related to the chart
      const chartKeywords = chart.description.toLowerCase().split(/\s+/);
      let bestMatch = -1;
      let bestScore = 0;
      
      paragraphs.forEach((para, paraIdx) => {
        const paraLower = para.toLowerCase();
        const score = chartKeywords.reduce((sum, keyword) => 
          sum + (paraLower.includes(keyword) ? 1 : 0), 0
        );
        if (score > bestScore && paraIdx < paragraphs.length - 1) {
          bestScore = score;
          bestMatch = paraIdx;
        }
      });
      
      if (bestMatch >= 0) {
        chartInsertions.push({ index: bestMatch + 1, chartIdx: idx });
      } else {
        // Fallback: insert after first paragraph, then second, etc.
        chartInsertions.push({ index: Math.min(idx + 1, paragraphs.length - 1), chartIdx: idx });
      }
    });
    
    // Insert charts in reverse order to maintain indices
    chartInsertions.sort((a, b) => b.index - a.index);
    chartInsertions.forEach(({ index, chartIdx }) => {
      if (index < paragraphs.length) {
        paragraphs.splice(index, 0, `<!--CHART_START:${chartIdx}:${charts[chartIdx].description.replace(/[<>]/g, '')}-->`);
      }
    });
    
    content = paragraphs.join('\n\n');
  }
  
  // Create tables using create_data_table tool if we have statistics
  // Track table captions to prevent duplicates
  const seenTableCaptions = new Set<string>();
  if (tables.length > 0) {
    for (const table of tables) {
      // Skip if we've already generated a table with this caption
      if (table.caption && seenTableCaptions.has(table.caption)) {
        console.log(`[ChartAgent] Skipping duplicate table: ${table.caption}`);
        continue;
      }
      
      if (table.caption) {
        seenTableCaptions.add(table.caption);
      }
      
      try {
        const toolResult = await executeTool('create_data_table', {
          headers: table.headers,
          rows: table.rows,
          caption: table.caption,
        }, {
          projectName: ctx.projectName,
          repoUrl: ctx.repoUrl,
          dataFiles: ctx.dataFiles,
        });
        
        const formattedResult = formatToolResultForDocument('create_data_table', toolResult);
        if (formattedResult.content) {
          content += '\n\n' + formattedResult.content;
        }
      } catch (error) {
        console.error('[ChartAgent] Failed to create table:', error);
        // Fallback: add markdown table directly
        const tableMarkdown = `\n\n### ${table.caption || 'Summary Table'}\n\n| ${table.headers.join(' | ')} |\n| ${table.headers.map(() => '---').join(' | ')} |\n${table.rows.map(row => `| ${row.join(' | ')} |`).join('\n')}\n`;
        content += tableMarkdown;
      }
    }
  }
  
  return { content, tables };
}

/**
 * Main ReAct workflow for chart generation
 */
export async function generateChartWithReAct(
  ctx: ChartAgentContext,
  sectionTitle: string,
  sectionInstructions: string
): Promise<ChartAgentResult> {
  console.log(`[ChartAgent] Starting ReAct workflow for: ${sectionTitle}`);

  // STEP 1: ANALYZE - Now includes sample data for better LLM decisions
  const { dataSummary, availableVariables, sampleData } = await analyze(ctx);

  // STEP 2: PLAN
  const plan = await createPlan(ctx, sectionTitle, sectionInstructions, dataSummary, availableVariables, sampleData);

  // STEP 3: EXECUTE - Pass sample data so LLM can generate appropriate code
  const { charts, analyses } = await execute(ctx, plan, sampleData);
  
  // STEP 4: PARSE
  const { keyFacts, statistics } = parse(analyses);
  
  // STEP 5: DOCUMENT
  const { content, tables } = await document(ctx, sectionTitle, sectionInstructions, plan, charts, analyses, keyFacts, statistics);
  
  // Store code per chart (for inline rendering)
  // The UI will split by the separator to get individual chart codes
  const allCode = charts.map((c, idx) => `# Chart ${idx + 1}: ${c.description}\n${c.code}`).join('\n\n# ---\n\n');

  const result = {
    content,
    generatedImages: charts.map(c => ({
      base64: c.base64,
      mimeType: c.mimeType,
      description: c.description,
    })),
    executedCode: allCode || undefined,
    analysisResults: statistics,
    tables,
  };

  console.log(`[ChartAgent] 🎯 Final result for "${sectionTitle}":`, {
    contentLength: content.length,
    generatedImagesCount: result.generatedImages.length,
    hasExecutedCode: !!allCode,
    tablesCount: tables.length,
  });

  return result;
}

