// Service to extract metadata from Go source files and markdown

import * as fs from 'fs';
import * as path from 'path';
import { TestMetadata, StageInfo } from '../../types/test.js';

export class MetadataExtractor {
  /**
   * Extract metadata from a Go source file header
   * Supports both legacy (5 fields) and new (12+ fields) formats
   */
  static extractFromGoFile(filePath: string): Partial<TestMetadata> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const metadata: Partial<TestMetadata> = {
      techniques: [],
      tactics: [],
      tags: [],
      integrations: [],
      stages: [],
      isMultiStage: false,
    };

    // Extract from header comment block (/* ... */)
    const headerMatch = content.match(/\/\*\s*([\s\S]*?)\*\//);
    if (headerMatch) {
      const header = headerMatch[1];

      // Extract ID
      const idMatch = header.match(/ID:\s*([a-f0-9-]+)/i);
      if (idMatch) {
        metadata.uuid = idMatch[1];
      }

      // Extract NAME
      const nameMatch = header.match(/NAME:\s*(.+)/i);
      if (nameMatch) {
        metadata.name = nameMatch[1].trim();
      }

      // Extract TECHNIQUES (plural, new format) or TECHNIQUE (singular, legacy)
      const techniquesMatch = header.match(/TECHNIQUES?:\s*(.+)/i);
      if (techniquesMatch) {
        metadata.techniques = techniquesMatch[1]
          .split(',')
          .map(t => t.trim())
          .filter(t => t);
      }

      // Extract TACTICS (comma-separated)
      const tacticsMatch = header.match(/TACTICS?:\s*(.+)/i);
      if (tacticsMatch) {
        metadata.tactics = tacticsMatch[1]
          .split(',')
          .map(t => t.trim())
          .filter(t => t);
      }

      // Extract SEVERITY
      const severityMatch = header.match(/SEVERITY:\s*(\w+)/i);
      if (severityMatch) {
        metadata.severity = severityMatch[1].trim().toLowerCase();
      }

      // Extract TARGET (comma-separated list)
      const targetMatch = header.match(/TARGET:\s*(.+)/i);
      if (targetMatch) {
        metadata.target = targetMatch[1].split(',').map(t => t.trim()).filter(Boolean);
      }

      // Extract COMPLEXITY
      const complexityMatch = header.match(/COMPLEXITY:\s*(\w+)/i);
      if (complexityMatch) {
        metadata.complexity = complexityMatch[1].trim().toLowerCase();
      }

      // Extract THREAT_ACTOR
      const threatActorMatch = header.match(/THREAT_ACTOR:\s*(.+)/i);
      if (threatActorMatch) {
        const actor = threatActorMatch[1].trim();
        // Handle "N/A" or empty values
        metadata.threatActor = (actor && actor.toLowerCase() !== 'n/a') ? actor : undefined;
      }

      // Extract SUBCATEGORY
      const subcategoryMatch = header.match(/SUBCATEGORY:\s*(.+)/i);
      if (subcategoryMatch) {
        metadata.subcategory = subcategoryMatch[1].trim();
      }

      // Extract INTEGRATIONS (comma-separated)
      const integrationsMatch = header.match(/INTEGRATIONS:\s*(.+)/i);
      if (integrationsMatch) {
        metadata.integrations = integrationsMatch[1]
          .split(',')
          .map(t => t.trim().toLowerCase())
          .filter(t => t && t !== 'none');
      }

      // Extract TAGS (comma-separated)
      const tagsMatch = header.match(/TAGS:\s*(.+)/i);
      if (tagsMatch) {
        metadata.tags = tagsMatch[1]
          .split(',')
          .map(t => t.trim())
          .filter(t => t);
      }

      // Extract AUTHOR
      const authorMatch = header.match(/AUTHOR:\s*(.+)/i);
      if (authorMatch) {
        metadata.author = authorMatch[1].trim();
      }

      // Extract CREATED date
      const createdMatch = header.match(/CREATED:\s*(.+)/i);
      if (createdMatch) {
        metadata.createdDate = createdMatch[1].trim();
      }

      // Extract UNIT (test unit identifier)
      const unitMatch = header.match(/UNIT:\s*(.+)/i);
      if (unitMatch) {
        metadata.unit = unitMatch[1].trim();
      }
    }

    // Extract from constants
    const constMatch = content.match(/const\s*\(\s*([\s\S]*?)\)/);
    if (constMatch) {
      const constants = constMatch[1];

      // Extract TEST_UUID
      const uuidMatch = constants.match(/TEST_UUID\s*=\s*"([^"]+)"/);
      if (uuidMatch && !metadata.uuid) {
        metadata.uuid = uuidMatch[1];
      }

      // Extract TEST_NAME
      const nameMatch = constants.match(/TEST_NAME\s*=\s*"([^"]+)"/);
      if (nameMatch && !metadata.name) {
        metadata.name = nameMatch[1];
      }
    }

    return metadata;
  }

  /**
   * Extract metadata from README.md file
   */
  static extractFromReadme(filePath: string): Partial<TestMetadata> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const metadata: Partial<TestMetadata> = {};

    // Extract score from header
    const scoreMatch = content.match(/\*\*Test Score\*\*:\s*\*\*(\d+(?:\.\d+)?)\/10\*\*/i);
    if (scoreMatch) {
      metadata.score = parseFloat(scoreMatch[1]);
    }

    // Extract description from Overview section
    const overviewMatch = content.match(/##\s*Overview\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (overviewMatch) {
      const overview = overviewMatch[1].trim();
      // Get first paragraph as description
      const firstParagraph = overview.split('\n\n')[0];
      metadata.description = firstParagraph.replace(/\*\*/g, '').trim();
    }

    // Extract techniques from MITRE ATT&CK Mapping section
    const techniqueMatches = content.matchAll(/\*\*(?:Stage \d+ - )?(T\d+(?:\.\d+)*)\*\*:/g);
    const techniques = Array.from(techniqueMatches, m => m[1]);
    if (techniques.length > 0) {
      metadata.techniques = techniques;
    }

    return metadata;
  }

  /**
   * Extract metadata from info card (_info.md file)
   */
  static extractFromInfoCard(filePath: string): Partial<TestMetadata> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const metadata: Partial<TestMetadata> = {
      scoreBreakdown: {},
    };

    // Extract category
    const categoryMatch = content.match(/\*\*Category\*\*:\s*(.+)/i);
    if (categoryMatch) {
      metadata.category = categoryMatch[1].trim();
    }

    // Extract severity
    const severityMatch = content.match(/\*\*Severity\*\*:\s*(\w+)/i);
    if (severityMatch) {
      metadata.severity = severityMatch[1].trim();
    }

    // Extract MITRE ATT&CK techniques
    const mitreMatch = content.match(/\*\*MITRE ATT&CK\*\*:\s*(.+)/i);
    if (mitreMatch) {
      metadata.techniques = mitreMatch[1]
        .split(',')
        .map(t => t.trim())
        .filter(t => t);
    }

    // Extract score
    const scoreMatch = content.match(/##\s*Test Score:\s*(\d+(?:\.\d+)?)\/10/i);
    if (scoreMatch) {
      metadata.score = parseFloat(scoreMatch[1]);
    }

    // Extract score breakdown from table
    const scoreTable = content.match(/\|\s*\*\*Real-World Accuracy\*\*\s*\|\s*\*\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\*\*/i);
    if (scoreTable) {
      metadata.scoreBreakdown!.realWorldAccuracy = parseFloat(scoreTable[1]);
    }

    const techSophMatch = content.match(/\|\s*\*\*Technical Sophistication\*\*\s*\|\s*\*\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\*\*/i);
    if (techSophMatch) {
      metadata.scoreBreakdown!.technicalSophistication = parseFloat(techSophMatch[1]);
    }

    const safetyMatch = content.match(/\|\s*\*\*Safety Mechanisms\*\*\s*\|\s*\*\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\*\*/i);
    if (safetyMatch) {
      metadata.scoreBreakdown!.safetyMechanisms = parseFloat(safetyMatch[1]);
    }

    const detectionMatch = content.match(/\|\s*\*\*Detection Opportunities\*\*\s*\|\s*\*\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\*\*/i);
    if (detectionMatch) {
      metadata.scoreBreakdown!.detectionOpportunities = parseFloat(detectionMatch[1]);
    }

    const loggingMatch = content.match(/\|\s*\*\*Logging & Observability\*\*\s*\|\s*\*\*(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\*\*/i);
    if (loggingMatch) {
      metadata.scoreBreakdown!.loggingObservability = parseFloat(loggingMatch[1]);
    }

    return metadata;
  }

  /**
   * Extract validator descriptions from _info.md "Bundled Validators" section.
   * Parses "### N. Validator Name" headings and takes the first line after as description.
   */
  static extractValidatorDescriptions(filePath: string): Record<string, string> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const descriptions: Record<string, string> = {};

    // Find the "Bundled Validators" section
    const sectionMatch = content.match(/##\s*Bundled Validators\s*\n([\s\S]*?)(?=\n##[^#]|$)/i);
    if (!sectionMatch) return descriptions;

    const section = sectionMatch[1];

    // Match each "### N. Validator Name" heading followed by content
    const validatorPattern = /###\s*\d+\.\s*(.+)\n([\s\S]*?)(?=\n###\s*\d+\.|$)/g;
    let match;
    while ((match = validatorPattern.exec(section)) !== null) {
      const name = match[1].trim();
      const body = match[2].trim();
      // First non-empty line is the description
      const firstLine = body.split('\n').find(l => l.trim().length > 0);
      if (firstLine) {
        descriptions[name] = firstLine.trim();
      }
    }

    return descriptions;
  }

  /**
   * Detect multi-stage architecture and extract stage information
   */
  static extractStageInfo(testDir: string): StageInfo[] {
    const stages: StageInfo[] = [];
    const files = fs.readdirSync(testDir);

    // Look for stage-T*.go files
    const stageFiles = files.filter(f => f.match(/^stage-T[\d.]+\.go$/i));

    stageFiles.forEach((fileName, index) => {
      const techniqueMatch = fileName.match(/stage-(T[\d.]+)\.go/i);
      if (techniqueMatch) {
        const technique = techniqueMatch[1];
        const filePath = path.join(testDir, fileName);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');

          // Extract stage name from header comment
          const nameMatch = content.match(/STAGE \d+:\s*(.+)/i);
          const stageName = nameMatch ? nameMatch[1].trim() : `Stage ${index + 1}`;

          // Extract stage ID
          const stageIdMatch = content.match(/STAGE_ID\s*=\s*(\d+)/);
          const stageId = stageIdMatch ? parseInt(stageIdMatch[1]) : index + 1;

          stages.push({
            stageId,
            technique,
            name: stageName,
            fileName,
          });
        } catch (error) {
          console.error(`Error reading stage file ${fileName}:`, error);
        }
      }
    });

    // Sort by stage ID
    return stages.sort((a, b) => a.stageId - b.stageId);
  }

  /**
   * Combine metadata from multiple sources
   * @param testDir - Full path to the test directory
   * @param uuid - The test UUID
   * @param category - The category folder name (optional, for categorical structure)
   */
  static extractTestMetadata(testDir: string, uuid: string, category?: string): TestMetadata {
    const metadata: Partial<TestMetadata> = {
      uuid,
      category, // Set from folder structure
      techniques: [],
      tactics: [],
      tags: [],
      integrations: [],
      stages: [],
      isMultiStage: false,
    };

    // Store category from folder structure (should not be overwritten)
    const folderCategory = category;

    // Extract from main Go file
    const mainGoFile = path.join(testDir, `${uuid}.go`);
    if (fs.existsSync(mainGoFile)) {
      const goData = this.extractFromGoFile(mainGoFile);
      // Merge arrays
      this.mergeArrayField(metadata, goData, 'techniques');
      this.mergeArrayField(metadata, goData, 'tactics');
      this.mergeArrayField(metadata, goData, 'tags');
      // Assign other fields (but not arrays, we already merged them)
      const { techniques, tactics, tags, ...otherGoData } = goData;
      Object.assign(metadata, otherGoData);
    }

    // Extract from README
    const readmePath = path.join(testDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      const readmeData = this.extractFromReadme(readmePath);
      // Merge techniques arrays
      this.mergeArrayField(metadata, readmeData, 'techniques');
      // Assign other fields
      const { techniques, ...otherReadmeData } = readmeData;
      Object.assign(metadata, otherReadmeData);
    }

    // Extract from info card
    const infoCardPath = path.join(testDir, `${uuid}_info.md`);
    if (fs.existsSync(infoCardPath)) {
      const infoData = this.extractFromInfoCard(infoCardPath);
      // Merge techniques arrays
      this.mergeArrayField(metadata, infoData, 'techniques');
      // Assign other fields
      const { techniques, ...otherInfoData } = infoData;
      Object.assign(metadata, otherInfoData);
    }

    // Extract validator descriptions from _info.md (for bundle tests)
    if (fs.existsSync(infoCardPath)) {
      const validatorDescs = this.extractValidatorDescriptions(infoCardPath);
      if (Object.keys(validatorDescs).length > 0) {
        metadata.validatorDescriptions = validatorDescs;
      }
    }

    // Extract stage information
    metadata.stages = this.extractStageInfo(testDir);
    metadata.isMultiStage = metadata.stages.length > 0;

    // Ensure folder category takes precedence over any extracted category
    if (folderCategory) {
      metadata.category = folderCategory;
    }

    return metadata as TestMetadata;
  }

  /**
   * Helper to merge array fields from source into target
   */
  private static mergeArrayField(
    target: Partial<TestMetadata>,
    source: Partial<TestMetadata>,
    field: 'techniques' | 'tactics' | 'tags'
  ): void {
    const sourceArray = source[field];
    if (sourceArray && sourceArray.length > 0) {
      const targetArray = target[field] || [];
      target[field] = Array.from(new Set([...targetArray, ...sourceArray]));
    }
  }
}
