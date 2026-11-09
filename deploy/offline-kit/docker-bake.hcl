# Offline kit images for one architecture, each written as a `docker load`
# tarball. Run by build-kit.sh (which sets the variables); paths are relative
# to the repository root (build-kit.sh runs it in a clean copy of HEAD).
#
# Images are named the way Compose names the images it builds
# (<project>-<service>), so `docker compose up` in a checkout called
# ProjectAchilles finds them loaded and builds nothing. They are exported
# straight to files and never tagged in the local image store, so building a
# kit can't replace the images of an install on the same machine.

variable "ARCH" { default = "amd64" }
variable "OUT" { default = "deploy/offline-kit/out/images" }
variable "PROJECT" { default = "projectachilles" }
variable "GIT_COMMIT" { default = "" }
variable "TESTS_REPO_URL" { default = "https://github.com/ubercylon8/f0_library.git" }
variable "TESTS_REPO_REF" { default = "main" }
variable "TESTS_REPO_COMMIT" { default = "" }
variable "KIT_TESTS" { default = "" }
variable "AGENT_VERSION" { default = "" }

# Same image as docker-compose.yml's elasticsearch service, pinned here by digest.
variable "ES_IMAGE" { default = "docker.elastic.co/elasticsearch/elasticsearch:8.17.0" }
variable "ES_DIGEST" { default = "sha256:2f602552550869fb29b6fd5848c5118d3ef3a2e1d5d45802e3ab9088cb2de8e2" }

function "tarball" {
  params = [file, name]
  result = ["type=docker,dest=${OUT}/${ARCH}/${file},name=${name}"]
}

group "default" {
  targets = ["backend", "frontend", "wiki", "es-seed", "elasticsearch"]
}

# The regular backend image; only used as the base of "backend".
target "backend-base" {
  context   = "backend"
  platforms = ["linux/${ARCH}"]
  args      = { GIT_COMMIT = GIT_COMMIT }
}

target "backend" {
  context    = "deploy/offline-kit"
  dockerfile = "backend-preload.Dockerfile"
  contexts   = { backend = "target:backend-base" }
  platforms  = ["linux/${ARCH}"]
  args = {
    TESTS_REPO_URL = TESTS_REPO_URL
    TESTS_REPO_REF    = TESTS_REPO_REF
    TESTS_REPO_COMMIT = TESTS_REPO_COMMIT
    KIT_TESTS      = KIT_TESTS
  }
  output = tarball("backend.tar", "${PROJECT}-backend:latest")
}

target "frontend" {
  context   = "frontend"
  platforms = ["linux/${ARCH}"]
  output    = tarball("frontend.tar", "${PROJECT}-frontend:latest")
}

target "wiki" {
  context   = "wiki"
  platforms = ["linux/${ARCH}"]
  output    = tarball("wiki.tar", "${PROJECT}-wiki:latest")
}

target "es-seed" {
  context   = "deploy/es-seed"
  platforms = ["linux/${ARCH}"]
  output    = tarball("es-seed.tar", "${PROJECT}-es-seed:latest")
}

# A pulled image, re-exported under the tag docker-compose.yml uses.
target "elasticsearch" {
  dockerfile-inline = "FROM ${ES_IMAGE}@${ES_DIGEST}"
  platforms         = ["linux/${ARCH}"]
  output            = tarball("elasticsearch.tar", ES_IMAGE)
}

# Agent and tests ship amd64 only; Apple Silicon runs this one emulated.
target "lab-endpoint" {
  context    = "."
  dockerfile = "deploy/lab-endpoint/Dockerfile"
  platforms  = ["linux/amd64"]
  args       = { AGENT_VERSION = AGENT_VERSION }
  output     = ["type=docker,dest=${OUT}/lab-endpoint.tar,name=${PROJECT}-lab-endpoint:latest"]
}
