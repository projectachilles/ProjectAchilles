// Service to extract metadata from Go source files and markdown

import * as fs from 'fs';
import * as path from 'path';
import { TestMetadata, StageInfo } from '../../types/test.js';

export class MetadataExtractor {
  /**
   * Extract metadata from a Go source file header
   */
  static extractFromGoFile(filePath: string): Partial<TestMetadata> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const metadata: Partial<TestMetadata> = {
      techniques: [],
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

      // Extract TECHNIQUE (comma-separated)
      const techniqueMatch = header.match(/TECHNIQUE:\s*(.+)/i);
      if (techniqueMatch) {
        metadata.techniques = techniqueMatch[1]
          .split(',')
          .map(t => t.trim())
          .filter(t => t);
      }

      // Extract CREATED date
      const createdMatch = header.match(/CREATED:\s*(.+)/i);
      if (createdMatch) {
        metadata.createdDate = createdMatch[1].trim();
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
   */
  static extractTestMetadata(testDir: string, uuid: string): TestMetadata {
    const metadata: Partial<TestMetadata> = {
      uuid,
      techniques: [],
      stages: [],
      isMultiStage: false,
    };

    // Extract from main Go file
    const mainGoFile = path.join(testDir, `${uuid}.go`);
    if (fs.existsSync(mainGoFile)) {
      Object.assign(metadata, this.extractFromGoFile(mainGoFile));
    }

    // Extract from README
    const readmePath = path.join(testDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      const readmeData = this.extractFromReadme(readmePath);
      // Merge techniques arrays
      if (readmeData.techniques && readmeData.techniques.length > 0) {
        metadata.techniques = Array.from(
          new Set([...(metadata.techniques || []), ...readmeData.techniques])
        );
      }
      Object.assign(metadata, { ...readmeData, techniques: metadata.techniques });
    }

    // Extract from info card
    const infoCardPath = path.join(testDir, `${uuid}_info.md`);
    if (fs.existsSync(infoCardPath)) {
      const infoData = this.extractFromInfoCard(infoCardPath);
      // Merge techniques arrays
      if (infoData.techniques && infoData.techniques.length > 0) {
        metadata.techniques = Array.from(
          new Set([...(metadata.techniques || []), ...infoData.techniques])
        );
      }
      Object.assign(metadata, { ...infoData, techniques: metadata.techniques });
    }

    // Extract stage information
    metadata.stages = this.extractStageInfo(testDir);
    metadata.isMultiStage = metadata.stages.length > 0;

    return metadata as TestMetadata;
  }
}
