# ProjectAchilles offline kit

Everything a first install would download, so you can install without a fast
network. You still need internet access for sign-in (Clerk).

**Before you start:** Docker Desktop (Windows, macOS) or Docker Engine with
Compose (Linux) is installed and running. About 8 GB of free disk (this kit is
2.2 GB; the loaded images take about 3.5 GB).

1. **Copy this whole folder** to your laptop (any folder).
2. **Load the kit.** From this folder:
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\kit.ps1`
   - macOS / Linux: `bash kit.sh`

   It checks the files, loads the images for your machine (Intel/AMD or Apple
   Silicon) and unpacks the source to `ProjectAchilles` in your home folder.
3. **Configure** (Clerk keys, secrets). Choose the **local** Elasticsearch.
   - Windows: `cd ~\ProjectAchilles`, then
     `powershell -ExecutionPolicy Bypass -File .\scripts\Install-ProjectAchilles.ps1 -NoBuild`
     (it also starts the stack; Git is not needed)
   - macOS / Linux: `cd ~/ProjectAchilles`, then `./scripts/setup.sh`
     (choose Docker; it only writes the configuration)
4. **Start everything, with the lab endpoint** (all systems, from `ProjectAchilles`):
   `docker compose --profile elasticsearch -f docker-compose.yml -f docker-compose.lab.yml up -d`

   It uses the loaded images; nothing is built or downloaded.

Then open <http://localhost>. `KIT-INFO.txt` shows the version in this kit.

---

# Kit sin conexión de ProjectAchilles

Todo lo que una primera instalación descargaría, para instalar sin una red
rápida. Aún necesitas internet para iniciar sesión (Clerk).

**Antes de empezar:** Docker Desktop (Windows, macOS) o Docker Engine con
Compose (Linux) instalado y en ejecución. Unos 8 GB libres en disco (este kit
ocupa 2,2 GB; las imágenes cargadas, unos 3,5 GB).

1. **Copia esta carpeta completa** a tu portátil (en cualquier carpeta).
2. **Carga el kit.** Desde esta carpeta:
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\kit.ps1`
   - macOS / Linux: `bash kit.sh`

   Verifica los archivos, carga las imágenes para tu equipo (Intel/AMD o Apple
   Silicon) y descomprime el código en `ProjectAchilles`, en tu carpeta personal.
3. **Configura** (claves de Clerk, secretos). Elige el Elasticsearch **local**.
   - Windows: `cd ~\ProjectAchilles` y luego
     `powershell -ExecutionPolicy Bypass -File .\scripts\Install-ProjectAchilles.ps1 -NoBuild`
     (también inicia los servicios; no necesita Git)
   - macOS / Linux: `cd ~/ProjectAchilles` y luego `./scripts/setup.sh`
     (elige Docker; solo escribe la configuración)
4. **Inicia todo, con el endpoint de laboratorio** (todos los sistemas, desde `ProjectAchilles`):
   `docker compose --profile elasticsearch -f docker-compose.yml -f docker-compose.lab.yml up -d`

   Usa las imágenes cargadas; no se construye ni se descarga nada.

Luego abre <http://localhost>. `KIT-INFO.txt` muestra la versión de este kit.
