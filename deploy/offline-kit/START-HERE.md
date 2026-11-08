# ProjectAchilles offline kit

Everything a first install would download, so you can install without a fast
network. You still need internet access for sign-in (Clerk).

**Before you start:** Docker Desktop (Windows, macOS) or Docker Engine with
Compose (Linux) is installed and running. About 8 GB of free disk.

1. **Copy this whole folder** to your laptop (any folder).
2. **Load the kit.** From this folder:
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\kit.ps1`
   - macOS / Linux: `./kit.sh`

   It checks the files, loads the images for your machine (Intel/AMD or Apple
   Silicon) and unpacks the source to `ProjectAchilles` in your home folder.
3. **Configure and start:**
   - Windows: `cd ~\ProjectAchilles`, then
     `powershell -ExecutionPolicy Bypass -File .\scripts\Install-ProjectAchilles.ps1 -NoBuild`
   - macOS / Linux: `cd ~/ProjectAchilles`, then `./scripts/setup.sh`

   Answer **yes** to the local Elasticsearch. It starts the stack from the
   loaded images; nothing is rebuilt.
4. **Add the lab endpoint:**
   `docker compose -f docker-compose.yml -f docker-compose.lab.yml up -d`

Then open <http://localhost>. `KIT-INFO.txt` shows the version in this kit.

---

# Kit sin conexión de ProjectAchilles

Todo lo que una primera instalación descargaría, para instalar sin una red
rápida. Aún necesitas internet para iniciar sesión (Clerk).

**Antes de empezar:** Docker Desktop (Windows, macOS) o Docker Engine con
Compose (Linux) instalado y en ejecución. Unos 8 GB libres en disco.

1. **Copia esta carpeta completa** a tu portátil (en cualquier carpeta).
2. **Carga el kit.** Desde esta carpeta:
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\kit.ps1`
   - macOS / Linux: `./kit.sh`

   Verifica los archivos, carga las imágenes para tu equipo (Intel/AMD o Apple
   Silicon) y descomprime el código en `ProjectAchilles`, en tu carpeta personal.
3. **Configura e inicia:**
   - Windows: `cd ~\ProjectAchilles` y luego
     `powershell -ExecutionPolicy Bypass -File .\scripts\Install-ProjectAchilles.ps1 -NoBuild`
   - macOS / Linux: `cd ~/ProjectAchilles` y luego `./scripts/setup.sh`

   Responde **sí** al Elasticsearch local. Inicia todo con las imágenes
   cargadas; no se reconstruye nada.
4. **Agrega el endpoint de laboratorio:**
   `docker compose -f docker-compose.yml -f docker-compose.lab.yml up -d`

Luego abre <http://localhost>. `KIT-INFO.txt` muestra la versión de este kit.
