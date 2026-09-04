// EN/ES copy for the ProjectAchilles ecosystem landing.
// EN strings are verbatim from design_handoff_ecosystem_landing/README.md —
// do not rewrite them. ES strings are idiomatic, not literal calques.
// Repo names, technique IDs, commands and URLs are never translated.

export type Lang = 'en' | 'es';

export type NodeKey = 'csv' | 'lib' | 'hpot' | 'pentest' | 'sectools' | 'hx' | 'agent' | 'env';
export type ToolKey = 'csv' | 'lib' | 'hpot' | 'pentest' | 'sectools' | 'hx';
export type LayerKey = 'validate' | 'deceive' | 'test';
export type StatusKey = 'production' | 'service' | 'development';
export type TerminalTone = 'cmd' | 'out' | 'hi';

export type NodeCopy = { layer: string; name: string; text: string; links: string };

export type LandingCopy = {
  signIn: string;
  nav: {
    why: string;
    ecosystem: string;
    tools: string;
    local: string;
    contribute: string;
    roadmap: string;
    cta: string;
  };
  hero: {
    eyebrow: string;
    h1a: string;
    h1b: string;
    h1c: string;
    sub: string;
  };
  ledger: {
    title: string;
    run: string;
    cols: { technique: string; name: string; prev: string; log: string; alert: string; miss: string };
    rows: string[];
    coverage: string;
    pct: string;
    pctLabel: string;
  };
  terminal: {
    host: string;
    live: string;
    lines: { text: string; tone: TerminalTone }[];
  };
  marquee: string[];
  manifesto: {
    eyebrow: string;
    statement: string;
    items: { t: string; d: string }[];
  };
  why: {
    eyebrow: string;
    title: string;
    bars: string[];
    source: string;
    facts: { fig: string; text: string; src: string }[];
  };
  map: {
    eyebrow: string;
    title: string;
    sub: string;
    layers: Record<LayerKey, string>;
    captions: Record<ToolKey, string>;
    agentName: string;
    agentCap: string;
    loop: string;
    envName: string;
    envCap: string;
    nodes: Record<NodeKey, NodeCopy>;
    defaultNode: NodeCopy;
  };
  tools: {
    eyebrow: string;
    title: string;
    status: Record<StatusKey, string>;
    layers: Record<LayerKey, string>;
    desc: Record<ToolKey, string>;
  };
  local: {
    eyebrow: string;
    title: string;
    p: string;
    caption: string;
    boundary: string;
    cells: string[];
    outbound: string;
    zero: string;
  };
  contribute: {
    eyebrow: string;
    title: string;
    lead: string;
    ways: string[];
    join: string;
    star: string;
    blog: string;
  };
  roadmap: {
    eyebrow: string;
    title: string;
    phases: { status: string; items: string[]; desc: string }[];
    link: string;
  };
  footer: {
    repos: string;
    community: string;
    license: string;
    discussions: string;
    blog: string;
    contributing: string;
    security: string;
    licenseName: string;
    licenseNote: string;
    copyright: string;
    tagline: string;
  };
};

export const COPY: Record<Lang, LandingCopy> = {
  en: {
    signIn: 'sign in →',
    nav: {
      why: 'why',
      ecosystem: 'ecosystem',
      tools: 'tools',
      local: 'local ai',
      contribute: 'contribute',
      roadmap: 'roadmap',
      cta: 'join the community →',
    },
    hero: {
      eyebrow: 'open source · apache 2.0 · work in progress',
      h1a: 'Open security',
      h1b: 'for the',
      h1c: 'agentic era.',
      sub: 'ProjectAchilles started as continuous security validation. Today it is a set of open-source tools that validate controls, deceive intruders and test systems, with AI agents that run inside your boundary and never send your data out. Built in the open, still being built.',
    },
    ledger: {
      title: 'f0_csv · detection coverage ledger',
      run: 'run 2026-09-04 · fleet: all',
      cols: { technique: 'technique', name: 'name', prev: 'prev', log: 'log', alert: 'alert', miss: 'miss' },
      rows: [
        'PowerShell execution',
        'LSASS memory read',
        'Registry run key persistence',
        'Process hollowing',
        'SMB lateral movement',
        'Disable security tooling',
        'Data encrypted for impact',
        'Exfiltration over DNS',
      ],
      coverage: 'coverage · 90 days',
      pct: '79%',
      pctLabel: 'alerted or prevented',
    },
    terminal: {
      host: 'achilles@ecosystem',
      live: '● live',
      lines: [
        { text: '› f0_csv run --suite mitre-top10 --fleet all', tone: 'cmd' },
        { text: '  48 techniques · 31 alerted · 9 logged · 8 missed', tone: 'out' },
        { text: '› f0_hpot status', tone: 'cmd' },
        { text: '  14 decoys · 2 touches in 24h → alert routed', tone: 'hi' },
        { text: '› f0_pentest recon --local-model', tone: 'cmd' },
        { text: '  0 bytes sent to third-party APIs', tone: 'out' },
        { text: '› hx assess https://app.internal', tone: 'cmd' },
        { text: '  harness: in development', tone: 'out' },
      ],
    },
    marquee: ['f0_csv', 'f0_library', 'f0_hpot', 'f0_pentest', 'f0_sectools', 'hx', 'validate', 'deceive', 'test'],
    manifesto: {
      eyebrow: '00 — what we believe',
      statement:
        'A control that is installed is not a control that works. The difference is only visible when you test it, and keep testing it.',
      items: [
        { t: 'Evidence over assumption', d: 'Every tool produces a measurable result: prevented, logged, alerted, missed.' },
        { t: 'Readable by anyone', d: 'Everything that runs on an endpoint is published. Audit it, fork it, keep it.' },
        { t: 'Data stays home', d: 'AI agents run inside your boundary. Logs, credentials and findings never reach a third-party API.' },
      ],
    },
    why: {
      eyebrow: '01 — why it matters',
      title: 'Most of the security stack is installed and silent.',
      bars: ['Attacks prevented', 'Attacks logged', 'Attacks that raised an alert'],
      source: 'Picus Security, Blue Report 2025 · 160M+ simulated attacks',
      facts: [
        {
          fig: '241',
          text: 'days on average to identify and contain a breach. Dwell time is what makes a breach expensive.',
          src: 'IBM, Cost of a Data Breach 2025',
        },
        {
          fig: 'NIS2',
          text: 'Medium and large entities in 18 sectors must demonstrate that measures exist and are tested. Management is personally accountable.',
          src: 'Directive (EU) 2022/2555',
        },
        {
          fig: 'Art. 32',
          text: 'GDPR requires a process for regularly testing, assessing and evaluating the effectiveness of security measures.',
          src: 'GDPR, Article 32',
        },
      ],
    },
    map: {
      eyebrow: '02 — the ecosystem',
      title: 'Three layers. Six tools. One loop.',
      sub: 'Hover a component to see what it does and how it connects. Validation proves the controls, deception catches what slips through, testing finds what neither saw.',
      layers: { validate: 'validate', deceive: 'deceive', test: 'test' },
      captions: {
        csv: 'runs emulations · scores detection',
        lib: 'the tests f0_csv runs',
        hpot: 'honeypots · canary tokens',
        pentest: 'offensive',
        sectools: 'defensive',
        hx: 'web apps · in development',
      },
      agentName: 'Local AI agent',
      agentCap: 'runs inside your boundary',
      loop: '↓ fix detections · re-run · ↑',
      envName: 'Your environment',
      envCap: 'endpoints · servers · web applications · telemetry',
      nodes: {
        csv: {
          layer: 'validate',
          name: 'f0_csv',
          text: 'Runs safe emulations of real attacker techniques on live endpoints and scores what the EDR did: prevented, logged, alerted or missed. Coverage is tracked as a trend, not a yearly snapshot.',
          links: 'reads f0_library · runs in your environment · in production',
        },
        lib: {
          layer: 'validate',
          name: 'f0_library',
          text: 'The open framework every emulation is written in: prerequisites, expected telemetry, cleanup and safety guards so a test never becomes an incident. Customers can read every test that runs on their machines.',
          links: 'consumed by f0_csv · MITRE ATT&CK mapped · in production',
        },
        hpot: {
          layer: 'deceive',
          name: 'f0_hpot',
          text: 'Self-hosted honeypots and canary tokens on any endpoint: decoy SSH, SMB, RDP, HTTP and database services, fake credentials, documents and API keys. Nobody legitimate touches them, so any touch is a high-fidelity alert.',
          links: 'alerts into your telemetry · self-hosted · in production',
        },
        pentest: {
          layer: 'test · offensive',
          name: 'f0_pentest',
          text: 'Offensive tools and skills for a locally running AI agent: reconnaissance, enumeration and exploitation playbooks run under engineer supervision, weekly or per change instead of once a year.',
          links: 'uses the local AI agent · targets your environment · in service',
        },
        sectools: {
          layer: 'test · defensive',
          name: 'f0_sectools',
          text: 'The defensive counterpart. Gives the local agent tools to read configuration, logs and telemetry and produce a posture and risk report, mapped to CIS, NIS2 Art. 21 and GDPR Art. 32.',
          links: 'uses the local AI agent · reads your telemetry · in service',
        },
        hx: {
          layer: 'test · web applications',
          name: 'hx',
          text: 'Agent-driven web application assessment harness. Drives Burp Suite Community as an engine: the agent issues requests, inspects responses and reasons about findings, with the harness recording and reporting.',
          links: 'uses the local AI agent · Burp Suite Community · in development',
        },
        agent: {
          layer: 'foundation',
          name: 'Local AI agent',
          text: 'A model running on hardware inside your boundary. f0_pentest, f0_sectools and hx give it tools; prompts, tool output and findings never reach a third-party API.',
          links: 'powers the test layer · no external AI calls',
        },
        env: {
          layer: 'target',
          name: 'Your environment',
          text: 'Endpoints, servers, web applications and the telemetry they produce. Every tool either acts on it or reads from it, and the fix loop closes back into your detections.',
          links: 'endpoints · servers · web apps · telemetry',
        },
      },
      defaultNode: {
        layer: 'the loop',
        name: 'Validate · Deceive · Test',
        text: 'Validation proves the controls you already have. Deception catches what slips past them. Testing finds what neither saw, with agents that never leave your boundary. Each layer feeds the others through shared telemetry.',
        links: 'hover a component to explore',
      },
    },
    tools: {
      eyebrow: '03 — the tools',
      title: 'Every repo is public.',
      status: { production: 'in production', service: 'in service', development: 'in development' },
      layers: { validate: 'validate', deceive: 'deceive', test: 'test' },
      desc: {
        csv: 'Continuous security validation. Safe emulations of attacker techniques on live endpoints, scored against what the EDR actually did.',
        lib: 'Open framework for high-quality, safe security tests. Prerequisites, expected telemetry, cleanup and safety guards, readable by anyone.',
        hpot: 'Self-hosted honeypots and canary tokens on any endpoint. Near-zero false positives; alerts route into your existing telemetry.',
        pentest: 'Offensive tools and skills for local AI agents. Continuous pentesting and red teaming without sending target data anywhere.',
        sectools: 'SecOps tools and skills for local AI agents. Configuration review, telemetry gap analysis and risk posture reports.',
        hx: 'Agent-driven web application assessment harness. Uses Burp Suite Community as an engine, not a front end.',
      },
    },
    local: {
      eyebrow: '04 — privacy-preserving ai',
      title: 'The agent comes to the data. Not the other way round.',
      p: 'f0_pentest, f0_sectools and hx give a locally running model the tools to test, review and report. Prompts, tool output and findings stay inside the boundary. No credentials, logs or target data are sent to a third-party AI API.',
      caption: 'Shadow AI added $670K to the average breach cost · IBM, 2025',
      boundary: 'your boundary',
      cells: ['Endpoints & telemetry', 'Logs & configuration', 'Local model + f0 agents', 'Findings & reports'],
      outbound: 'outbound to third-party AI APIs',
      zero: '0 bytes',
    },
    contribute: {
      eyebrow: '05 — open source',
      title: 'This is not finished. That is the point.',
      lead: 'Six tools, a small team, and a long list of things we know are missing. Every component is Apache 2.0. If you run security for a small organisation, write detection rules, or just want to read what runs on your endpoints, there is a way in.',
      ways: [
        'Write a test for f0_library',
        'Run f0_csv on your own fleet and file what breaks',
        'Add a decoy service or token type to f0_hpot',
        'Contribute a skill to f0_pentest or f0_sectools',
        'Tell us what is wrong in Discussions',
      ],
      join: 'join the community →',
      star: 'star on github',
      blog: 'read the blog',
    },
    roadmap: {
      eyebrow: '06 — where it is going',
      title: 'Work in progress, in the open.',
      phases: [
        { status: 'in production', items: ['f0_csv', 'f0_library', 'f0_hpot'], desc: 'Validation and deception, running daily.' },
        { status: 'in service', items: ['f0_pentest', 'f0_sectools'], desc: 'Local-agent testing and posture reviews with early users.' },
        { status: 'in development', items: ['hx'], desc: 'Agent-driven web application assessments on Burp Suite Community.' },
        {
          status: 'next',
          items: ['Unified console'],
          desc: 'One report across validation, deception and testing. Test SDK, STIX/TAXII feeds, AI test recommendations.',
        },
      ],
      link: 'Full roadmap on GitHub. Dates are aspirational, not commitments. →',
    },
    footer: {
      repos: 'repositories',
      community: 'community',
      license: 'license',
      discussions: 'Discussions',
      blog: 'Blog · EN / ES',
      contributing: 'Contributing guide',
      security: 'Security policy',
      licenseName: 'Apache 2.0',
      licenseNote: 'Read it, audit it, keep it. Every component that runs in an environment is published.',
      copyright: '© 2026 ProjectAchilles',
      tagline: 'stop hoping your defenses work · start proving it',
    },
  },

  es: {
    signIn: 'iniciar sesión →',
    nav: {
      why: 'por qué',
      ecosystem: 'ecosistema',
      tools: 'herramientas',
      local: 'ia local',
      contribute: 'contribuir',
      roadmap: 'hoja de ruta',
      cta: 'únete a la comunidad →',
    },
    hero: {
      eyebrow: 'código abierto · apache 2.0 · en construcción',
      h1a: 'Seguridad abierta',
      h1b: 'para la',
      h1c: 'era agéntica.',
      sub: 'ProjectAchilles empezó como validación continua de seguridad. Hoy es un conjunto de herramientas de código abierto que validan controles, engañan a intrusos y prueban sistemas, con agentes de IA que corren dentro de tu perímetro y nunca envían tus datos fuera. Construido en abierto, todavía en construcción.',
    },
    ledger: {
      title: 'f0_csv · registro de cobertura de detección',
      run: 'ejecución 2026-09-04 · flota: todas',
      cols: { technique: 'técnica', name: 'nombre', prev: 'prev', log: 'log', alert: 'alerta', miss: 'fallo' },
      rows: [
        'Ejecución de PowerShell',
        'Lectura de memoria LSASS',
        'Persistencia por clave Run del registro',
        'Process hollowing',
        'Movimiento lateral por SMB',
        'Desactivar herramientas de seguridad',
        'Datos cifrados para impacto',
        'Exfiltración por DNS',
      ],
      coverage: 'cobertura · 90 días',
      pct: '79%',
      pctLabel: 'alertado o prevenido',
    },
    terminal: {
      host: 'achilles@ecosystem',
      live: '● en vivo',
      lines: [
        { text: '› f0_csv run --suite mitre-top10 --fleet all', tone: 'cmd' },
        { text: '  48 técnicas · 31 alertadas · 9 registradas · 8 no detectadas', tone: 'out' },
        { text: '› f0_hpot status', tone: 'cmd' },
        { text: '  14 señuelos · 2 contactos en 24h → alerta enrutada', tone: 'hi' },
        { text: '› f0_pentest recon --local-model', tone: 'cmd' },
        { text: '  0 bytes enviados a APIs de terceros', tone: 'out' },
        { text: '› hx assess https://app.internal', tone: 'cmd' },
        { text: '  harness: en desarrollo', tone: 'out' },
      ],
    },
    marquee: ['f0_csv', 'f0_library', 'f0_hpot', 'f0_pentest', 'f0_sectools', 'hx', 'validar', 'engañar', 'probar'],
    manifesto: {
      eyebrow: '00 — en qué creemos',
      statement:
        'Un control instalado no es un control que funciona. La diferencia solo se ve cuando lo pruebas, y sigues probándolo.',
      items: [
        { t: 'Evidencia antes que suposición', d: 'Cada herramienta produce un resultado medible: prevenido, registrado, alertado, no detectado.' },
        { t: 'Legible por cualquiera', d: 'Todo lo que corre en un endpoint está publicado. Audítalo, haz un fork, quédatelo.' },
        { t: 'Los datos se quedan en casa', d: 'Los agentes de IA corren dentro de tu perímetro. Logs, credenciales y hallazgos nunca llegan a una API de terceros.' },
      ],
    },
    why: {
      eyebrow: '01 — por qué importa',
      title: 'La mayor parte del stack de seguridad está instalado y en silencio.',
      bars: ['Ataques prevenidos', 'Ataques registrados', 'Ataques que generaron una alerta'],
      source: 'Picus Security, Blue Report 2025 · 160M+ ataques simulados',
      facts: [
        {
          fig: '241',
          text: 'días de media para identificar y contener una brecha. El tiempo de permanencia es lo que encarece una brecha.',
          src: 'IBM, Cost of a Data Breach 2025',
        },
        {
          fig: 'NIS2',
          text: 'Entidades medianas y grandes de 18 sectores deben demostrar que las medidas existen y se prueban. La dirección responde personalmente.',
          src: 'Directiva (UE) 2022/2555',
        },
        {
          fig: 'Art. 32',
          text: 'El RGPD exige un proceso para probar, evaluar y valorar regularmente la eficacia de las medidas de seguridad.',
          src: 'RGPD, Artículo 32',
        },
      ],
    },
    map: {
      eyebrow: '02 — el ecosistema',
      title: 'Tres capas. Seis herramientas. Un ciclo.',
      sub: 'Pasa el ratón por un componente para ver qué hace y cómo se conecta. La validación demuestra los controles, el engaño atrapa lo que se cuela, las pruebas encuentran lo que ninguno vio.',
      layers: { validate: 'validar', deceive: 'engañar', test: 'probar' },
      captions: {
        csv: 'ejecuta emulaciones · puntúa la detección',
        lib: 'las pruebas que ejecuta f0_csv',
        hpot: 'honeypots · tokens canario',
        pentest: 'ofensivo',
        sectools: 'defensivo',
        hx: 'apps web · en desarrollo',
      },
      agentName: 'Agente de IA local',
      agentCap: 'corre dentro de tu perímetro',
      loop: '↓ corrige detecciones · vuelve a ejecutar · ↑',
      envName: 'Tu entorno',
      envCap: 'endpoints · servidores · aplicaciones web · telemetría',
      nodes: {
        csv: {
          layer: 'validar',
          name: 'f0_csv',
          text: 'Ejecuta emulaciones seguras de técnicas reales de atacantes en endpoints en producción y puntúa lo que hizo el EDR: prevenido, registrado, alertado o no detectado. La cobertura se sigue como tendencia, no como una foto anual.',
          links: 'lee f0_library · corre en tu entorno · en producción',
        },
        lib: {
          layer: 'validar',
          name: 'f0_library',
          text: 'El framework abierto en el que se escribe cada emulación: prerrequisitos, telemetría esperada, limpieza y salvaguardas para que una prueba nunca se convierta en un incidente. Los clientes pueden leer cada prueba que corre en sus máquinas.',
          links: 'consumido por f0_csv · mapeado a MITRE ATT&CK · en producción',
        },
        hpot: {
          layer: 'engañar',
          name: 'f0_hpot',
          text: 'Honeypots y tokens canario autoalojados en cualquier endpoint: servicios señuelo SSH, SMB, RDP, HTTP y de base de datos, credenciales, documentos y claves de API falsos. Nadie legítimo los toca, así que cualquier contacto es una alerta de alta fidelidad.',
          links: 'alerta en tu telemetría · autoalojado · en producción',
        },
        pentest: {
          layer: 'probar · ofensivo',
          name: 'f0_pentest',
          text: 'Herramientas y skills ofensivos para un agente de IA que corre en local: playbooks de reconocimiento, enumeración y explotación ejecutados bajo supervisión de un ingeniero, cada semana o por cambio en lugar de una vez al año.',
          links: 'usa el agente de IA local · apunta a tu entorno · en servicio',
        },
        sectools: {
          layer: 'probar · defensivo',
          name: 'f0_sectools',
          text: 'La contraparte defensiva. Da al agente local herramientas para leer configuración, logs y telemetría y producir un informe de postura y riesgo, mapeado a CIS, NIS2 Art. 21 y RGPD Art. 32.',
          links: 'usa el agente de IA local · lee tu telemetría · en servicio',
        },
        hx: {
          layer: 'probar · aplicaciones web',
          name: 'hx',
          text: 'Harness de evaluación de aplicaciones web dirigido por agente. Usa Burp Suite Community como motor: el agente emite peticiones, inspecciona respuestas y razona sobre los hallazgos, mientras el harness registra e informa.',
          links: 'usa el agente de IA local · Burp Suite Community · en desarrollo',
        },
        agent: {
          layer: 'base',
          name: 'Agente de IA local',
          text: 'Un modelo que corre en hardware dentro de tu perímetro. f0_pentest, f0_sectools y hx le dan herramientas; prompts, salida de herramientas y hallazgos nunca llegan a una API de terceros.',
          links: 'impulsa la capa de pruebas · sin llamadas externas de IA',
        },
        env: {
          layer: 'objetivo',
          name: 'Tu entorno',
          text: 'Endpoints, servidores, aplicaciones web y la telemetría que producen. Cada herramienta actúa sobre él o lee de él, y el ciclo de corrección vuelve a cerrarse en tus detecciones.',
          links: 'endpoints · servidores · apps web · telemetría',
        },
      },
      defaultNode: {
        layer: 'el ciclo',
        name: 'Validar · Engañar · Probar',
        text: 'La validación demuestra los controles que ya tienes. El engaño atrapa lo que se les escapa. Las pruebas encuentran lo que ninguno vio, con agentes que nunca salen de tu perímetro. Cada capa alimenta a las otras a través de telemetría compartida.',
        links: 'pasa el ratón por un componente para explorar',
      },
    },
    tools: {
      eyebrow: '03 — las herramientas',
      title: 'Cada repo es público.',
      status: { production: 'en producción', service: 'en servicio', development: 'en desarrollo' },
      layers: { validate: 'validar', deceive: 'engañar', test: 'probar' },
      desc: {
        csv: 'Validación continua de seguridad. Emulaciones seguras de técnicas de atacantes en endpoints en producción, puntuadas contra lo que el EDR hizo realmente.',
        lib: 'Framework abierto para pruebas de seguridad seguras y de alta calidad. Prerrequisitos, telemetría esperada, limpieza y salvaguardas, legibles por cualquiera.',
        hpot: 'Honeypots y tokens canario autoalojados en cualquier endpoint. Falsos positivos casi nulos; las alertas se enrutan a tu telemetría existente.',
        pentest: 'Herramientas y skills ofensivos para agentes de IA locales. Pentesting y red teaming continuos sin enviar datos del objetivo a ningún sitio.',
        sectools: 'Herramientas y skills de SecOps para agentes de IA locales. Revisión de configuración, análisis de brechas de telemetría e informes de postura de riesgo.',
        hx: 'Harness de evaluación de aplicaciones web dirigido por agente. Usa Burp Suite Community como motor, no como interfaz.',
      },
    },
    local: {
      eyebrow: '04 — ia que preserva la privacidad',
      title: 'El agente va a los datos. No al revés.',
      p: 'f0_pentest, f0_sectools y hx dan a un modelo que corre en local las herramientas para probar, revisar e informar. Prompts, salida de herramientas y hallazgos se quedan dentro del perímetro. No se envían credenciales, logs ni datos del objetivo a una API de IA de terceros.',
      caption: 'La IA en la sombra añadió $670K al coste medio de una brecha · IBM, 2025',
      boundary: 'tu perímetro',
      cells: ['Endpoints y telemetría', 'Logs y configuración', 'Modelo local + agentes f0', 'Hallazgos e informes'],
      outbound: 'salida hacia APIs de IA de terceros',
      zero: '0 bytes',
    },
    contribute: {
      eyebrow: '05 — código abierto',
      title: 'Esto no está terminado. Esa es la idea.',
      lead: 'Seis herramientas, un equipo pequeño y una larga lista de cosas que sabemos que faltan. Cada componente es Apache 2.0. Si llevas la seguridad de una organización pequeña, escribes reglas de detección o solo quieres leer lo que corre en tus endpoints, hay una forma de entrar.',
      ways: [
        'Escribe una prueba para f0_library',
        'Ejecuta f0_csv en tu propia flota y reporta lo que falle',
        'Añade un servicio señuelo o un tipo de token a f0_hpot',
        'Aporta un skill a f0_pentest o f0_sectools',
        'Cuéntanos qué está mal en Discussions',
      ],
      join: 'únete a la comunidad →',
      star: 'estrella en github',
      blog: 'lee el blog',
    },
    roadmap: {
      eyebrow: '06 — hacia dónde va',
      title: 'Trabajo en curso, en abierto.',
      phases: [
        { status: 'en producción', items: ['f0_csv', 'f0_library', 'f0_hpot'], desc: 'Validación y engaño, corriendo a diario.' },
        { status: 'en servicio', items: ['f0_pentest', 'f0_sectools'], desc: 'Pruebas con agente local y revisiones de postura con primeros usuarios.' },
        { status: 'en desarrollo', items: ['hx'], desc: 'Evaluaciones de aplicaciones web dirigidas por agente sobre Burp Suite Community.' },
        {
          status: 'siguiente',
          items: ['Consola unificada'],
          desc: 'Un solo informe para validación, engaño y pruebas. SDK de pruebas, feeds STIX/TAXII, recomendaciones de pruebas con IA.',
        },
      ],
      link: 'Hoja de ruta completa en GitHub. Las fechas son aspiracionales, no compromisos. →',
    },
    footer: {
      repos: 'repositorios',
      community: 'comunidad',
      license: 'licencia',
      discussions: 'Discussions',
      blog: 'Blog · EN / ES',
      contributing: 'Guía de contribución',
      security: 'Política de seguridad',
      licenseName: 'Apache 2.0',
      licenseNote: 'Léelo, audítalo, quédatelo. Cada componente que corre en un entorno está publicado.',
      copyright: '© 2026 ProjectAchilles',
      tagline: 'deja de esperar que tus defensas funcionen · empieza a demostrarlo',
    },
  },
};
