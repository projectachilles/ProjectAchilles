// EN/ES copy for the Achilles landing redesign.
// Strings are intentionally idiomatic Spanish, not literal calques —
// keep verbatim per design handoff (e.g. "BAS empresarial sin la factura empresarial").

export type Lang = 'en' | 'es';

export type LandingCopy = {
  nav: {
    whyCST: string;
    compliance: string;
    platform: string;
    how: string;
    coverage: string;
    compare: string;
    docs: string;
    star: string;
    cta: string;
  };
  hero: {
    status: string;
    pre: string;
    accent: string;
    sub: string;
    ctaPrimary: string;
    ctaSecondary: string;
    meta1Value: string;
    meta1Label: string;
    meta2Value: string;
    meta2Label: string;
    meta3Value: string;
    meta3Label: string;
    vizTitle: string;
    vizStatus: string;
    vizFloatTop: string;
    vizFloatBot: string;
    vizScoreA: string;
    vizScoreB: string;
  };
  trust: { label: string };
  problem: {
    eyebrow: string;
    title: string;
    sub: string;
    items: { t: string; d: string }[];
  };
  reg: {
    eyebrow: string;
    title: string;
    sub: string;
    coverage: string;
    coverageNote: string;
  };
  features: {
    eyebrow: string;
    title: string;
    sub: string;
    items: { t: string; d: string }[];
  };
  how: {
    eyebrow: string;
    title: string;
    sub: string;
    stage: string;
    steps: { title: string; desc: string }[];
  };
  mitre: {
    eyebrow: string;
    title: string;
    sub: string;
    filterAll: string;
    filterProtected: string;
    filterPartial: string;
    filterGap: string;
    statProtected: string;
    statPartial: string;
    statGap: string;
    statTests: string;
    legendProtected: string;
    legendPartial: string;
    legendGap: string;
    legendUntested: string;
    tactics: string[];
  };
  compare: {
    eyebrow: string;
    title: string;
    sub: string;
    colCap: string;
    colUs: string;
    footnote: string;
    rows: (string | 'yes' | 'no' | 'partial')[][];
  };
  security: {
    eyebrow: string;
    title: string;
    sub: string;
    items: string[];
  };
  cta: {
    eyebrow: string;
    titleA: string;
    titleB: string;
    sub: string;
    primary: string;
    secondary: string;
    tertiary: string;
  };
  footer: {
    tagline: string;
    colPlatform: string;
    colCompliance: string;
    colCommunity: string;
    links: {
      features: string;
      how: string;
      coverage: string;
      compare: string;
      github: string;
      discord: string;
      docs: string;
      security: string;
    };
    copyright: string;
    bottomTag: string;
  };
};

export type Framework = {
  id: 'dora' | 'tiber' | 'iso' | 'cis' | 'mitre';
  name: string;
  tag: string;
  stat: string;
  title: string;
  desc: string;
  controls: string[];
  coverage: number;
};

export const COPY: Record<Lang, LandingCopy> = {
  en: {
    nav: {
      whyCST: 'Why CST',
      compliance: 'Compliance',
      platform: 'Platform',
      how: 'How it works',
      coverage: 'Coverage',
      compare: 'Compare',
      docs: 'Docs',
      star: 'Star',
      cta: 'Get started',
    },
    hero: {
      status: 'Open-source · Continuous Security Testing',
      pre: 'Every organization has an',
      accent: 'Achilles Heel.',
      sub: 'Achilles is the open-source Continuous Security Testing platform for any organization, of any size. Validate every control against real APT tradecraft — mapped to MITRE ATT&CK, DORA, TIBER-EU, ISO 27001, and CIS.',
      ctaPrimary: 'Get started',
      ctaSecondary: 'Star on GitHub',
      meta1Value: '500+',
      meta1Label: 'MITRE-mapped tests',
      meta2Value: '5 min',
      meta2Label: 'Time to first scan',
      meta3Value: 'Apache 2.0',
      meta3Label: 'Self-host or PaaS',
      vizTitle: 'achilles@cmd ~ campaign · apt29',
      vizStatus: 'live',
      vizFloatTop: '51 test bundles · 7 d uptime',
      vizFloatBot: 'DORA Art.25 evidence ready',
      vizScoreA: 'Defense Score',
      vizScoreB: 'Secure Score',
    },
    trust: { label: 'Built for · trusted by · aligned with' },
    problem: {
      eyebrow: 'The problem',
      title: 'Security tools without proof they work.',
      sub: 'Most organizations invest seven figures in EDR, SIEM, and hardening — then hope. The post-mortem after a breach reveals gaps that were always there, never measured. Continuous Security Testing closes that loop.',
      items: [
        { t: 'Point-in-time testing', d: "Annual pentests are obsolete the day they ship. Threats don't wait for your audit cycle — neither should validation." },
        { t: 'Compliance ≠ resilience', d: 'Checking ISO and DORA boxes provides legal cover, but zero evidence that your stack actually detects an APT.' },
        { t: 'Unmeasurable ROI', d: "CISOs can't quantify the risk reduction of a $4M security stack. Boards want numbers, not vendor decks." },
        { t: 'Blind spots compound', d: 'Unknown gaps let adversaries dwell for months. The 2024 IBM report puts mean detection at 204 days.' },
      ],
    },
    reg: {
      eyebrow: 'Regulatory alignment',
      title: 'Evidence your supervisors will accept.',
      sub: 'Every test maps to the frameworks that determine your audit outcomes — financial regulators, ISMS auditors, and red-team programs alike.',
      coverage: 'Achilles coverage',
      coverageNote: 'of {fw} controls have at least one validated test',
    },
    features: {
      eyebrow: 'Platform',
      title: 'The whole loop, in one box.',
      sub: 'Threat ingestion through evidence reporting — six modules that close the gap between what your tools claim and what they actually do.',
      items: [
        { t: 'AI-driven test development', d: 'Multi-agent pipeline turns CISA advisories into deployable test packages — code, detections, hardening, docs.' },
        { t: 'Lightweight Go agent', d: 'Static binary for Windows, Linux, macOS. Token enrolment, Ed25519 signing, AES-256-GCM, self-update.' },
        { t: 'Defense Score analytics', d: '30+ Elasticsearch endpoints. MITRE heatmaps, coverage treemaps, host-test matrices, trend charts.' },
        { t: 'CLI + AI chat agent', d: '17 command modules. Conversational fleet operations. --json on every command for pipeline integration.' },
        { t: 'Defender + EDR sync', d: 'Microsoft Graph, CrowdStrike, SentinelOne. Cross-correlate validation results with EDR posture data.' },
        { t: 'Build & sign pipeline', d: 'Go cross-compilation across 6 targets. Authenticode, ad-hoc macOS signing. Up to 5 certs managed.' },
      ],
    },
    how: {
      eyebrow: 'How it works',
      title: 'From CISA bulletin to board-ready evidence in minutes.',
      sub: 'Four stages, fully automated. Click each to see the actual command output.',
      stage: 'Stage',
      steps: [
        { title: 'Ingest threat intel', desc: 'CISA, MITRE, vendor reports → IOCs and TTPs' },
        { title: 'Generate tests',      desc: 'Multi-agent AI builds 19 artifacts per technique' },
        { title: 'Build & sign',        desc: 'Cross-compiled binaries, code-signed for production' },
        { title: 'Deploy & measure',    desc: 'Fleet executes, detections fire, score updates' },
      ],
    },
    mitre: {
      eyebrow: 'Coverage matrix',
      title: 'Know exactly where your defense ends.',
      sub: 'Live MITRE ATT&CK heatmap from a representative production fleet. Hover any cell to inspect the test, severity, and last-seen detection.',
      filterAll: 'all',
      filterProtected: 'protected',
      filterPartial: 'partial',
      filterGap: 'gap',
      statProtected: 'protected',
      statPartial: 'partial',
      statGap: 'gap',
      statTests: 'tests',
      legendProtected: 'Protected',
      legendPartial: 'Partial',
      legendGap: 'Gap',
      legendUntested: 'Untested',
      tactics: [
        'Initial Access', 'Execution', 'Persistence', 'Priv Esc', 'Defense Evasion',
        'Credential', 'Discovery', 'Lat. Movement', 'Collection', 'Exfiltration', 'Impact',
      ],
    },
    compare: {
      eyebrow: 'How we compare',
      title: 'Enterprise BAS without the enterprise invoice.',
      sub: "Achilles occupies the same category as AttackIQ, SafeBreach, and Picus — purpose-built for institutions that can't justify a $200K licence to prove their EDR works.",
      colCap: 'Capability',
      colUs: 'Achilles',
      footnote: 'Pricing references: public RFP listings 2024–2025. AttackIQ, SafeBreach and Picus are trademarks of their respective owners.',
      rows: [
        ['MITRE ATT&CK alignment', 'yes', 'yes', 'yes', 'yes'],
        ['DORA / TIBER-EU evidence packets', 'yes', 'partial', 'partial', 'no'],
        ['Open source · Apache 2.0', 'yes', 'no', 'no', 'no'],
        ['Self-host · air-gapped', 'yes', 'partial', 'no', 'no'],
        ['Go agent · 6 platforms', 'yes', 'partial', 'partial', 'yes'],
        ['AI test generation pipeline', 'yes', 'no', 'no', 'partial'],
        ['Starting price (annual)', 'Free', '$200K+', '$150K+', '$180K+'],
      ],
    },
    security: {
      eyebrow: 'Hardened by default',
      title: 'Built like the systems it protects.',
      sub: "Code-signed agents, encrypted config, Ed25519 attestations — production security testing shouldn't introduce production risk.",
      items: [
        'AES-256-GCM encrypted config',
        'Ed25519 binary signatures',
        'Replay protection · 5-min skew',
        'Zero-downtime key rotation',
        'TLS enforcement everywhere',
        'Per-endpoint rate limiting',
      ],
    },
    cta: {
      eyebrow: 'Stop hoping. Start proving.',
      titleA: "Your Achilles' heel is already there.",
      titleB: 'The only question is who finds it first.',
      sub: 'Deploy in five minutes. Self-host on your own iron, or run on the PaaS for $8/month. Apache 2.0 — no licence handshake, no procurement gauntlet.',
      primary: 'Get started',
      secondary: 'Star on GitHub',
      tertiary: 'Join Discord →',
    },
    footer: {
      tagline: 'Open-source Continuous Security Testing for any organization. MITRE ATT&CK, DORA, TIBER-EU, ISO 27001, CIS — built on a Go agent and an AI test pipeline.',
      colPlatform: 'Platform',
      colCompliance: 'Compliance',
      colCommunity: 'Community',
      links: {
        features: 'Features',
        how: 'How it works',
        coverage: 'Coverage',
        compare: 'vs AttackIQ',
        github: 'GitHub',
        discord: 'Discord',
        docs: 'Docs',
        security: 'Security policy',
      },
      copyright: '© 2026 PROJECT ACHILLES · APACHE 2.0',
      bottomTag: 'STOP HOPING YOUR DEFENSES WORK · START PROVING IT',
    },
  },
  es: {
    nav: {
      whyCST: 'Por qué CST',
      compliance: 'Cumplimiento',
      platform: 'Plataforma',
      how: 'Cómo funciona',
      coverage: 'Cobertura',
      compare: 'Comparativa',
      docs: 'Docs',
      star: 'Estrella',
      cta: 'Comenzar',
    },
    hero: {
      status: 'Open-source · Continuous Security Testing',
      pre: 'Toda organización tiene un',
      accent: 'Talón de Aquiles.',
      sub: 'Achilles es la plataforma open-source de Continuous Security Testing para cualquier organización, de cualquier tamaño. Valida cada control contra técnicas APT reales — mapeadas a MITRE ATT&CK, DORA, TIBER-EU, ISO 27001 y CIS.',
      ctaPrimary: 'Comenzar',
      ctaSecondary: 'Danos una estrella',
      meta1Value: '500+',
      meta1Label: 'Tests mapeados a MITRE',
      meta2Value: '5 min',
      meta2Label: 'Hasta el primer escaneo',
      meta3Value: 'Apache 2.0',
      meta3Label: 'Self-host o PaaS',
      vizTitle: 'achilles@cmd ~ campaña · apt29',
      vizStatus: 'en vivo',
      vizFloatTop: '51 paquetes de tests · 7 d activo',
      vizFloatBot: 'Evidencia DORA Art.25 lista',
      vizScoreA: 'Defense Score',
      vizScoreB: 'Secure Score',
    },
    trust: { label: 'Diseñado para · alineado con' },
    problem: {
      eyebrow: 'El problema',
      title: 'Herramientas de seguridad sin pruebas de que funcionan.',
      sub: 'La mayoría de las organizaciones invierten siete cifras en EDR, SIEM y hardening — y luego confían en la suerte. El post-mortem tras una brecha revela vacíos que siempre estuvieron ahí, nunca medidos. El Continuous Security Testing cierra ese ciclo.',
      items: [
        { t: 'Tests puntuales', d: 'Los pentests anuales quedan obsoletos el día que se entregan. Las amenazas no esperan a tu ciclo de auditoría — la validación tampoco debería.' },
        { t: 'Cumplimiento ≠ resiliencia', d: 'Marcar casillas de ISO y DORA da cobertura legal, pero cero evidencia de que tu stack realmente detecta a un APT.' },
        { t: 'ROI inconmensurable', d: 'Los CISOs no pueden cuantificar la reducción de riesgo de un stack de seguridad de millones. Los consejos quieren números, no presentaciones de proveedores.' },
        { t: 'Los puntos ciegos se acumulan', d: 'Las brechas desconocidas permiten que los adversarios persistan durante meses. El informe IBM 2024 sitúa la detección media en 204 días.' },
      ],
    },
    reg: {
      eyebrow: 'Alineación regulatoria',
      title: 'Evidencia que tus supervisores aceptarán.',
      sub: 'Cada test se mapea a los marcos que determinan los resultados de tus auditorías — reguladores financieros, auditores ISMS y programas de red-team por igual.',
      coverage: 'Cobertura de Achilles',
      coverageNote: 'de los controles de {fw} tienen al menos un test validado',
    },
    features: {
      eyebrow: 'Plataforma',
      title: 'Todo el ciclo, en una sola caja.',
      sub: 'Desde la ingesta de inteligencia hasta los informes de evidencia — seis módulos que cierran la brecha entre lo que tus herramientas afirman y lo que realmente hacen.',
      items: [
        { t: 'Desarrollo de tests con IA', d: 'Pipeline multi-agente que convierte avisos de CISA en paquetes de tests desplegables — código, detecciones, hardening y documentación.' },
        { t: 'Agente Go ligero', d: 'Binario estático para Windows, Linux y macOS. Enrolamiento por token, firma Ed25519, AES-256-GCM, auto-actualización.' },
        { t: 'Analítica Defense Score', d: '30+ endpoints de Elasticsearch. Heatmaps MITRE, treemaps de cobertura, matrices host-test, gráficos de tendencias.' },
        { t: 'CLI + agente de chat IA', d: '17 módulos de comandos. Operaciones conversacionales sobre la flota. --json en cada comando para integración con pipelines.' },
        { t: 'Sincronización Defender + EDR', d: 'Microsoft Graph, CrowdStrike, SentinelOne. Correlación cruzada de resultados con datos de postura del EDR.' },
        { t: 'Pipeline de build y firma', d: 'Compilación cruzada Go en 6 targets. Authenticode, firma ad-hoc en macOS. Hasta 5 certificados gestionados.' },
      ],
    },
    how: {
      eyebrow: 'Cómo funciona',
      title: 'Del boletín CISA a evidencia para el consejo en minutos.',
      sub: 'Cuatro etapas, totalmente automatizadas. Haz clic en cada una para ver la salida real del comando.',
      stage: 'Etapa',
      steps: [
        { title: 'Ingesta de inteligencia', desc: 'CISA, MITRE, reportes de proveedores → IOCs y TTPs' },
        { title: 'Generación de tests',     desc: 'IA multi-agente construye 19 artefactos por técnica' },
        { title: 'Build y firma',           desc: 'Binarios cross-compiled, firmados para producción' },
        { title: 'Despliegue y medición',   desc: 'La flota ejecuta, las detecciones disparan, el score se actualiza' },
      ],
    },
    mitre: {
      eyebrow: 'Matriz de cobertura',
      title: 'Sabe exactamente dónde termina tu defensa.',
      sub: 'Heatmap MITRE ATT&CK en vivo de una flota productiva representativa. Pasa el cursor sobre cualquier celda para inspeccionar el test, la severidad y la última detección.',
      filterAll: 'todos',
      filterProtected: 'protegido',
      filterPartial: 'parcial',
      filterGap: 'brecha',
      statProtected: 'protegidos',
      statPartial: 'parciales',
      statGap: 'brechas',
      statTests: 'tests',
      legendProtected: 'Protegido',
      legendPartial: 'Parcial',
      legendGap: 'Brecha',
      legendUntested: 'Sin testear',
      tactics: [
        'Acceso Inicial', 'Ejecución', 'Persistencia', 'Esc. Privilegios', 'Evasión',
        'Credenciales', 'Descubrimiento', 'Mov. Lateral', 'Recolección', 'Exfiltración', 'Impacto',
      ],
    },
    compare: {
      eyebrow: 'Cómo comparamos',
      title: 'BAS empresarial sin la factura empresarial.',
      sub: 'Achilles ocupa la misma categoría que AttackIQ, SafeBreach y Picus — diseñado para instituciones que no pueden justificar una licencia de $200K para demostrar que su EDR funciona.',
      colCap: 'Capacidad',
      colUs: 'Achilles',
      footnote: 'Referencias de precios: listados públicos de RFP 2024–2025. AttackIQ, SafeBreach y Picus son marcas registradas de sus respectivos propietarios.',
      rows: [
        ['Alineación MITRE ATT&CK', 'yes', 'yes', 'yes', 'yes'],
        ['Paquetes de evidencia DORA / TIBER-EU', 'yes', 'partial', 'partial', 'no'],
        ['Open source · Apache 2.0', 'yes', 'no', 'no', 'no'],
        ['Self-host · entornos aislados', 'yes', 'partial', 'no', 'no'],
        ['Agente Go · 6 plataformas', 'yes', 'partial', 'partial', 'yes'],
        ['Pipeline IA de generación de tests', 'yes', 'no', 'no', 'partial'],
        ['Precio inicial (anual)', 'Gratis', '$200K+', '$150K+', '$180K+'],
      ],
    },
    security: {
      eyebrow: 'Endurecido por defecto',
      title: 'Construido como los sistemas que protege.',
      sub: 'Agentes firmados, configuración cifrada, atestaciones Ed25519 — los tests de seguridad en producción no deberían introducir riesgos en producción.',
      items: [
        'Configuración cifrada AES-256-GCM',
        'Firmas Ed25519 de binarios',
        'Protección anti-replay · margen 5 min',
        'Rotación de claves sin downtime',
        'Aplicación de TLS en todas partes',
        'Rate limiting por endpoint',
      ],
    },
    cta: {
      eyebrow: 'Deja de esperar. Empieza a demostrar.',
      titleA: 'Tu talón de Aquiles ya está ahí.',
      titleB: 'La única pregunta es quién lo encuentra primero.',
      sub: 'Despliegue en cinco minutos. Self-host en tu propia infraestructura, o ejecuta en el PaaS por $8/mes. Apache 2.0 — sin acuerdo de licencia, sin gauntlet de adquisiciones.',
      primary: 'Comenzar',
      secondary: 'Danos una estrella',
      tertiary: 'Únete a Discord →',
    },
    footer: {
      tagline: 'Continuous Security Testing open-source para cualquier organización. MITRE ATT&CK, DORA, TIBER-EU, ISO 27001, CIS — construido sobre un agente Go y un pipeline de tests con IA.',
      colPlatform: 'Plataforma',
      colCompliance: 'Cumplimiento',
      colCommunity: 'Comunidad',
      links: {
        features: 'Características',
        how: 'Cómo funciona',
        coverage: 'Cobertura',
        compare: 'vs AttackIQ',
        github: 'GitHub',
        discord: 'Discord',
        docs: 'Docs',
        security: 'Política de seguridad',
      },
      copyright: '© 2026 PROJECT ACHILLES · APACHE 2.0',
      bottomTag: 'DEJA DE ESPERAR QUE TUS DEFENSAS FUNCIONEN · EMPIEZA A DEMOSTRARLO',
    },
  },
};

export const FRAMEWORKS: Record<Lang, Framework[]> = {
  en: [
    {
      id: 'dora', name: 'DORA', tag: 'EU · 2025', stat: 'Art. 24–27',
      title: 'DORA Threat-Led Penetration Testing',
      desc: 'Digital Operational Resilience Act mandates ICT risk testing and TLPT for systemically important EU financial entities. Achilles produces the evidence packet supervisors expect.',
      controls: [
        'Art. 24 — comprehensive ICT testing programme',
        'Art. 25 — vulnerability assessments and scenario-based tests',
        'Art. 26 — advanced TLPT every 3 years',
        'Art. 27 — testers and reporting',
      ],
      coverage: 96,
    },
    {
      id: 'tiber', name: 'TIBER-EU', tag: 'ECB', stat: 'Red-team ready',
      title: 'TIBER-EU Threat Intelligence-Based Ethical Red-Teaming',
      desc: 'ECB framework for intelligence-led red-teaming on live production systems. Achilles emulation packages drop straight into TIBER-EU TTI and Red Team scenarios.',
      controls: [
        'Generic Threat Landscape ingestion',
        'Targeted Threat Intelligence enrichment',
        'Red-team replay of APT chains',
        'Evidence chain for the Test Manager',
      ],
      coverage: 92,
    },
    {
      id: 'iso', name: 'ISO 27001', tag: '2022', stat: 'Annex A · 93',
      title: 'ISO/IEC 27001:2022 Annex A controls',
      desc: 'Continuous validation evidence for ISMS controls — particularly the technological controls block (A.8) and the new threat-intelligence control (A.5.7).',
      controls: [
        'A.5.7 — threat intelligence',
        'A.8.7 — protection against malware',
        'A.8.8 — management of technical vulnerabilities',
        'A.8.16 — monitoring activities',
      ],
      coverage: 88,
    },
    {
      id: 'cis', name: 'CIS v8', tag: 'CIS Controls', stat: '18 controls',
      title: 'CIS Critical Security Controls v8',
      desc: 'Achilles tests map directly to CIS v8 safeguards — exposing the gap between policy and operational reality, with replayable evidence per safeguard.',
      controls: [
        'CSC 8 — audit log management',
        'CSC 10 — malware defenses',
        'CSC 13 — network monitoring',
        'CSC 18 — penetration testing',
      ],
      coverage: 94,
    },
    {
      id: 'mitre', name: 'MITRE ATT&CK', tag: 'v15', stat: '11 tactics',
      title: 'MITRE ATT&CK Enterprise',
      desc: 'Every test in Achilles is mapped to a technique. Heatmaps show what you cover, where you have partial detection, and where the adversary owns you.',
      controls: [
        '500+ techniques covered',
        'Sub-technique granularity',
        'Threat-group emulation playbooks',
        'Detection rule export (Sigma, KQL, EQL)',
      ],
      coverage: 91,
    },
  ],
  es: [
    {
      id: 'dora', name: 'DORA', tag: 'UE · 2025', stat: 'Art. 24–27',
      title: 'DORA — Pruebas de Penetración Basadas en Amenazas',
      desc: 'El Reglamento de Resiliencia Operativa Digital exige pruebas de riesgo TIC y TLPT para entidades financieras sistémicas en la UE. Achilles produce el paquete de evidencia que esperan los supervisores.',
      controls: [
        'Art. 24 — programa integral de pruebas TIC',
        'Art. 25 — evaluaciones de vulnerabilidades y pruebas por escenario',
        'Art. 26 — TLPT avanzado cada 3 años',
        'Art. 27 — testers y reporte',
      ],
      coverage: 96,
    },
    {
      id: 'tiber', name: 'TIBER-EU', tag: 'BCE', stat: 'Listo para red-team',
      title: 'TIBER-EU — Red-Teaming Ético Basado en Inteligencia',
      desc: 'Marco del BCE para red-teaming basado en inteligencia sobre sistemas productivos. Los paquetes de emulación de Achilles encajan directamente en los escenarios TTI y Red Team de TIBER-EU.',
      controls: [
        'Ingesta del Generic Threat Landscape',
        'Enriquecimiento con Targeted Threat Intelligence',
        'Replay de cadenas APT por el red-team',
        'Cadena de evidencia para el Test Manager',
      ],
      coverage: 92,
    },
    {
      id: 'iso', name: 'ISO 27001', tag: '2022', stat: 'Anexo A · 93',
      title: 'Controles del Anexo A de ISO/IEC 27001:2022',
      desc: 'Evidencia de validación continua para controles ISMS — particularmente el bloque de controles tecnológicos (A.8) y el nuevo control de inteligencia de amenazas (A.5.7).',
      controls: [
        'A.5.7 — inteligencia de amenazas',
        'A.8.7 — protección contra malware',
        'A.8.8 — gestión de vulnerabilidades técnicas',
        'A.8.16 — actividades de monitorización',
      ],
      coverage: 88,
    },
    {
      id: 'cis', name: 'CIS v8', tag: 'CIS Controls', stat: '18 controles',
      title: 'CIS Critical Security Controls v8',
      desc: 'Los tests de Achilles se mapean directamente a las salvaguardas de CIS v8 — exponiendo la brecha entre la política y la realidad operativa, con evidencia reproducible por salvaguarda.',
      controls: [
        'CSC 8 — gestión de logs de auditoría',
        'CSC 10 — defensas contra malware',
        'CSC 13 — monitorización de red',
        'CSC 18 — pentesting',
      ],
      coverage: 94,
    },
    {
      id: 'mitre', name: 'MITRE ATT&CK', tag: 'v15', stat: '11 tácticas',
      title: 'MITRE ATT&CK Enterprise',
      desc: 'Cada test en Achilles se mapea a una técnica. Los heatmaps muestran qué cubres, dónde tienes detección parcial y dónde el adversario te domina.',
      controls: [
        '500+ técnicas cubiertas',
        'Granularidad por sub-técnica',
        'Playbooks de emulación por grupo APT',
        'Exportación de reglas de detección (Sigma, KQL, EQL)',
      ],
      coverage: 91,
    },
  ],
};

export const STEP_BODIES: Record<Lang, { t: 'cmt' | 'cmd' | 'ok' | 'warn' | 'err' | 'out' | 'prompt'; x: string }[][]> = {
  en: [
    [
      { t: 'cmt', x: '// 01 · Threat intel ingestion' },
      { t: 'cmd', x: '$ achilles ingest --source cisa-aa24-241a.pdf' },
      { t: 'ok',  x: '[parse] 47 IOCs · 12 ATT&CK techniques' },
      { t: 'ok',  x: '[map]   T1059.001 T1053.005 T1486 T1071.001 ...' },
      { t: 'warn',x: '[ctx]   Threat actor: COZY BEAR (APT29)' },
      { t: 'prompt', x: '→ intel package ready · agent pipeline armed' },
    ],
    [
      { t: 'cmt', x: '// 02 · AI test generation' },
      { t: 'cmd', x: '$ achilles generate --techniques T1059,T1486' },
      { t: 'ok',  x: '[agent-1] Go source · PowerShell exec' },
      { t: 'ok',  x: '[agent-2] Detection rules · Sigma + KQL + EQL' },
      { t: 'ok',  x: '[agent-3] Hardening · PowerShell + Bash' },
      { t: 'ok',  x: '[agent-4] Kill-chain diagram · operator runbook' },
      { t: 'prompt', x: '→ 2 techniques × 19 artifacts = 38 files' },
    ],
    [
      { t: 'cmt', x: '// 03 · Build · sign · attest' },
      { t: 'cmd', x: '$ achilles build --all-platforms --sign' },
      { t: 'ok',  x: '[build] windows/amd64 · 2.1 MB · OK' },
      { t: 'ok',  x: '[build] linux/amd64   · 1.9 MB · OK' },
      { t: 'ok',  x: '[build] darwin/arm64  · 1.8 MB · OK' },
      { t: 'ok',  x: '[sign]  Authenticode + ad-hoc + Ed25519' },
      { t: 'prompt', x: '→ 6 binaries attested · ready to ship' },
    ],
    [
      { t: 'cmt', x: '// 04 · Fleet execution' },
      { t: 'cmd', x: '$ achilles deploy --fleet production' },
      { t: 'ok',  x: '[fleet] 247 endpoints · heartbeat OK' },
      { t: 'ok',  x: '[exec]  T1059.001 ............. DETECTED' },
      { t: 'err', x: '[exec]  T1486 ................ MISSED' },
      { t: 'warn',x: '[score] Defense 73% (+5.2 / 7d)' },
      { t: 'prompt', x: '→ DORA / ISO / CIS evidence packet exported' },
    ],
  ],
  es: [
    [
      { t: 'cmt', x: '// 01 · Ingesta de inteligencia' },
      { t: 'cmd', x: '$ achilles ingest --source cisa-aa24-241a.pdf' },
      { t: 'ok',  x: '[parse] 47 IOCs · 12 técnicas ATT&CK' },
      { t: 'ok',  x: '[map]   T1059.001 T1053.005 T1486 T1071.001 ...' },
      { t: 'warn',x: '[ctx]   Actor: COZY BEAR (APT29)' },
      { t: 'prompt', x: '→ paquete listo · pipeline de agentes armado' },
    ],
    [
      { t: 'cmt', x: '// 02 · Generación con IA' },
      { t: 'cmd', x: '$ achilles generate --techniques T1059,T1486' },
      { t: 'ok',  x: '[agent-1] Código Go · ejecución PowerShell' },
      { t: 'ok',  x: '[agent-2] Reglas de detección · Sigma + KQL + EQL' },
      { t: 'ok',  x: '[agent-3] Hardening · PowerShell + Bash' },
      { t: 'ok',  x: '[agent-4] Diagrama kill-chain · runbook' },
      { t: 'prompt', x: '→ 2 técnicas × 19 artefactos = 38 archivos' },
    ],
    [
      { t: 'cmt', x: '// 03 · Build · firma · attest' },
      { t: 'cmd', x: '$ achilles build --all-platforms --sign' },
      { t: 'ok',  x: '[build] windows/amd64 · 2.1 MB · OK' },
      { t: 'ok',  x: '[build] linux/amd64   · 1.9 MB · OK' },
      { t: 'ok',  x: '[build] darwin/arm64  · 1.8 MB · OK' },
      { t: 'ok',  x: '[sign]  Authenticode + ad-hoc + Ed25519' },
      { t: 'prompt', x: '→ 6 binarios atestados · listos para desplegar' },
    ],
    [
      { t: 'cmt', x: '// 04 · Ejecución en flota' },
      { t: 'cmd', x: '$ achilles deploy --fleet production' },
      { t: 'ok',  x: '[fleet] 247 endpoints · heartbeat OK' },
      { t: 'ok',  x: '[exec]  T1059.001 ............. DETECTADO' },
      { t: 'err', x: '[exec]  T1486 ................ NO DETECTADO' },
      { t: 'warn',x: '[score] Defense 73% (+5.2 / 7d)' },
      { t: 'prompt', x: '→ paquete de evidencia DORA / ISO / CIS exportado' },
    ],
  ],
};

export type HeroTerminalLine = { type: 'cmt' | 'cmd' | 'out' | 'ok' | 'warn' | 'err' | 'prompt'; text: string };

export const HERO_TERMINAL_LINES: Record<Lang, HeroTerminalLine[]> = {
  en: [
    { type: 'cmt', text: '// CST run · 2026-04-25 · production fleet (n=247)' },
    { type: 'cmd', text: '$ achilles emulate --campaign apt29 --scope=tier1' },
    { type: 'out', text: '[ingest] 47 TTPs from CISA AA24-241A → MITRE ATT&CK' },
    { type: 'ok',  text: '[exec]  T1059.001 PowerShell ............. DETECTED' },
    { type: 'ok',  text: '[exec]  T1071.001 C2 over HTTPS ........... DETECTED' },
    { type: 'warn',text: '[exec]  T1027 Obfuscated Files ....... PARTIAL' },
    { type: 'err', text: '[exec]  T1486 Data Encrypted ............ MISSED' },
    { type: 'ok',  text: '[exec]  T1003.001 LSASS Memory .......... DETECTED' },
    { type: 'out', text: '[score] Defense 73% · Secure 90.9% · Δ +5.2 / 7d' },
    { type: 'prompt', text: '→ evidence packet · DORA Art.25 · ISO A.5.7 · CIS 18' },
  ],
  es: [
    { type: 'cmt', text: '// ejecución CST · 2026-04-25 · flota productiva (n=247)' },
    { type: 'cmd', text: '$ achilles emulate --campaign apt29 --scope=tier1' },
    { type: 'out', text: '[ingest] 47 TTPs de CISA AA24-241A → MITRE ATT&CK' },
    { type: 'ok',  text: '[exec]  T1059.001 PowerShell ............. DETECTADO' },
    { type: 'ok',  text: '[exec]  T1071.001 C2 sobre HTTPS .......... DETECTADO' },
    { type: 'warn',text: '[exec]  T1027 Ofuscación .............. PARCIAL' },
    { type: 'err', text: '[exec]  T1486 Cifrado de Datos ......... NO DETECTADO' },
    { type: 'ok',  text: '[exec]  T1003.001 LSASS Memory .......... DETECTADO' },
    { type: 'out', text: '[score] Defense 73% · Secure 90.9% · Δ +5.2 / 7d' },
    { type: 'prompt', text: '→ paquete de evidencia · DORA Art.25 · ISO A.5.7 · CIS 18' },
  ],
};
