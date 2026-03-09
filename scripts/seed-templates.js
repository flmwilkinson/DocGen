/**
 * Seed MRM Templates into Database
 * Run with: node scripts/seed-templates.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'mrm');

async function seedTemplates() {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('Connected to database\n');

    // Ensure demo user exists
    let demoUser = await prisma.user.findFirst({
      where: { email: 'demo@docgen.ai' }
    });

    if (!demoUser) {
      demoUser = await prisma.user.create({
        data: {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'demo@docgen.ai',
          name: 'Demo User',
        }
      });
      console.log('Created demo user');
    }

    // Read all template files
    const templateFiles = fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.json'));

    console.log(`Found ${templateFiles.length} template files\n`);

    for (const filename of templateFiles) {
      const filePath = path.join(TEMPLATES_DIR, filename);
      const content = fs.readFileSync(filePath, 'utf-8');
      const templateJson = JSON.parse(content);

      console.log(`Processing: ${templateJson.name}`);

      // Check if template already exists
      const existing = await prisma.template.findFirst({
        where: {
          name: templateJson.name,
          createdById: demoUser.id
        }
      });

      if (existing) {
        // Update existing template
        await prisma.template.update({
          where: { id: existing.id },
          data: {
            description: templateJson.description,
            templateJson: JSON.stringify(templateJson),
            isPublic: true,
            version: { increment: 1 },
          }
        });
        console.log(`  Updated: ${existing.id}`);
      } else {
        // Create new template
        const created = await prisma.template.create({
          data: {
            name: templateJson.name,
            description: templateJson.description,
            templateJson: JSON.stringify(templateJson),
            isPublic: true,
            createdById: demoUser.id,
          }
        });
        console.log(`  Created: ${created.id}`);
      }
    }

    console.log('\n=== Template seeding complete ===');

    // List all templates
    const allTemplates = await prisma.template.findMany({
      select: { id: true, name: true, isPublic: true, createdAt: true }
    });
    console.log('\nAvailable templates:');
    allTemplates.forEach(t => {
      console.log(`  - ${t.name} (${t.id})`);
    });

  } catch (error) {
    console.error('Error seeding templates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedTemplates();
