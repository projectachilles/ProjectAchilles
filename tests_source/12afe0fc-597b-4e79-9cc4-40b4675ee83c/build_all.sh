#!/bin/bash
# LimaCharlie Timeout Validation Harness - Build Script
# F0RT1KA Security Testing Framework
#
# This script builds the timeout validation test harness with 3 embedded stages.
# Each stage waits 2 minutes, resulting in ~6 minute total runtime.
#
# Usage: ./build_all.sh [--org <org-identifier>] [--es <profile>]

set -e  # Exit on any error
set -u  # Exit on undefined variable

# ==============================================================================
# CONFIGURATION
# ==============================================================================

TEST_UUID="12afe0fc-597b-4e79-9cc4-40b4675ee83c"

# Stage binaries (stage number : source file without extension)
declare -a STAGES=(
    "1:stage-T1497.001-1"
    "2:stage-T1497.001-2"
    "3:stage-T1497.001-3"
)

# ==============================================================================
# DO NOT EDIT BELOW THIS LINE
# ==============================================================================

# Parse command-line arguments
ORG_CERT=""
ES_PROFILE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --org)
            ORG_CERT="$2"
            shift 2
            ;;
        --es)
            ES_PROFILE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--org <org-identifier>] [--es <profile>]"
            echo ""
            echo "Options:"
            echo "  --org <id>    Organization for dual signing (UUID or short name)"
            echo "  --es <prof>   Elasticsearch profile for direct result export"
            echo "  -h, --help    Show this help message"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option: $1"
            exit 1
            ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEST_DIR="${PROJECT_ROOT}/tests_source/${TEST_UUID}"
BUILD_DIR="${PROJECT_ROOT}/build/${TEST_UUID}"

# Source helpers
if [ -f "${PROJECT_ROOT}/utils/resolve_org.sh" ]; then
    source "${PROJECT_ROOT}/utils/resolve_org.sh"
fi

if [ -f "${PROJECT_ROOT}/utils/resolve_es.sh" ]; then
    source "${PROJECT_ROOT}/utils/resolve_es.sh"
fi

# Determine signing mode
if [ -z "$ORG_CERT" ]; then
    SIGNING_MODE="single"
    PRIMARY_CERT="${PROJECT_ROOT}/signing-certs/F0RT1KA.pfx"
    PRIMARY_PASSWORD_FILE="${PROJECT_ROOT}/signing-certs/.F0RT1KA.pfx.txt"
else
    SIGNING_MODE="dual"
    if command -v resolve_org_to_cert &> /dev/null; then
        CERT_FILE=$(resolve_org_to_cert "$ORG_CERT")
        if [ $? -ne 0 ] || [ -z "$CERT_FILE" ]; then
            echo -e "${RED}ERROR: Could not resolve organization '$ORG_CERT'${NC}"
            exit 1
        fi
        ORG_CERT_FILE="${PROJECT_ROOT}/signing-certs/${CERT_FILE}"
    else
        ORG_CERT_FILE=$(find "${PROJECT_ROOT}/signing-certs" -name "*.pfx" | grep -i "$ORG_CERT" | head -1)
    fi
    SECONDARY_CERT="${PROJECT_ROOT}/signing-certs/F0RT1KA.pfx"
    SECONDARY_PASSWORD_FILE="${PROJECT_ROOT}/signing-certs/.F0RT1KA.pfx.txt"
fi

# Helper functions
print_header() {
    echo -e "${BLUE}=================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}=================================================${NC}"
}

print_step() {
    echo -e "${GREEN}[$1] $2${NC}"
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_error() {
    echo -e "${RED}ERROR: $1${NC}"
}

# Generate ES config
generate_es_config() {
    local config_file="${TEST_DIR}/es_config.go"

    if [ -z "$ES_PROFILE" ]; then
        cat > "${config_file}" << 'EOF'
//go:build windows

package main

const ES_ENABLED = false
const ES_ENDPOINT = ""
const ES_INDEX = ""
const ES_APIKEY = ""
EOF
        echo "  ES export: DISABLED"
    else
        if ! command -v resolve_es_to_endpoint &> /dev/null; then
            print_error "ES registry helper not available"
            exit 1
        fi

        local es_endpoint=$(resolve_es_to_endpoint "$ES_PROFILE")
        local es_index=$(resolve_es_to_index "$ES_PROFILE")
        local es_apikey=$(resolve_es_to_apikey "$ES_PROFILE")

        if [ -z "$es_apikey" ]; then
            local apikey_envvar=$(resolve_es_to_apikey_envvar "$ES_PROFILE")
            print_error "ES API key not set. Set: export ${apikey_envvar}='your-api-key'"
            exit 1
        fi

        cat > "${config_file}" << EOF
//go:build windows

package main

const ES_ENABLED = true
const ES_ENDPOINT = "${es_endpoint}"
const ES_INDEX = "${es_index}"
const ES_APIKEY = "${es_apikey}"
EOF
        echo "  ES export: ENABLED (${ES_PROFILE})"
    fi
}

# ==============================================================================
# BUILD PROCESS
# ==============================================================================

print_header "Timeout Validation Harness Build: ${TEST_UUID}"

# Step 0: Validate
print_step "0/7" "Validating environment..."
if [ ! -d "${TEST_DIR}" ]; then
    print_error "Test directory not found: ${TEST_DIR}"
    exit 1
fi
generate_es_config
print_success "Environment validated"

cd "${TEST_DIR}"

# Step 1: Build unsigned stage binaries
print_step "1/7" "Building unsigned stage binaries..."
stage_count=0
for stage_def in "${STAGES[@]}"; do
    IFS=':' read -r stage_num source_file <<< "$stage_def"
    stage_binary="${source_file}.exe"
    source_go="${source_file}.go"

    echo "  Building ${stage_binary}..."
    GOOS=windows GOARCH=amd64 go build -o "${stage_binary}" "${source_go}"

    stage_count=$((stage_count + 1))
done
print_success "Built ${stage_count} stage binaries"

# Step 2: Sign stage binaries
if [ "$SIGNING_MODE" = "dual" ]; then
    print_step "2/7" "Dual-signing stage binaries..."
    for stage_def in "${STAGES[@]}"; do
        IFS=':' read -r _ source_file <<< "$stage_def"
        stage_binary="${source_file}.exe"
        echo "  Dual-signing ${stage_binary}..."
        "${PROJECT_ROOT}/utils/codesign" sign-nested "${stage_binary}" "${ORG_CERT_FILE}" "${SECONDARY_CERT}"
    done
else
    print_step "2/7" "Signing stage binaries (F0RT1KA)..."
    for stage_def in "${STAGES[@]}"; do
        IFS=':' read -r _ source_file <<< "$stage_def"
        stage_binary="${source_file}.exe"
        echo "  Signing ${stage_binary}..."
        "${PROJECT_ROOT}/utils/codesign" sign "${stage_binary}"
    done
fi
print_success "Signed ${stage_count} stage binaries"

# Step 3: Verify signatures
print_step "3/7" "Verifying signatures..."
if command -v osslsigncode &> /dev/null; then
    for stage_def in "${STAGES[@]}"; do
        IFS=':' read -r _ source_file <<< "$stage_def"
        stage_binary="${source_file}.exe"
        if osslsigncode verify "${stage_binary}" 2>&1 | grep -q "Message digest"; then
            echo "  ${stage_binary}: Signature valid"
        else
            print_error "Signature verification failed: ${stage_binary}"
            exit 1
        fi
    done
    print_success "All signatures verified"
else
    echo "  Skipping (osslsigncode not installed)"
fi

# Step 4: Build main orchestrator (embeds signed stages)
print_step "4/7" "Building main orchestrator..."
mkdir -p "${BUILD_DIR}"
main_binary="${BUILD_DIR}/${TEST_UUID}.exe"

GOOS=windows GOARCH=amd64 go build -o "${main_binary}" \
    "${TEST_UUID}.go" test_logger.go org_resolver.go es_config.go

main_size=$(ls -lh "${main_binary}" | awk '{print $5}')
print_success "Main orchestrator built (${main_size})"

# Step 5: Sign main binary
cd "${PROJECT_ROOT}"
if [ "$SIGNING_MODE" = "dual" ]; then
    print_step "5/7" "Dual-signing main binary..."
    "${PROJECT_ROOT}/utils/codesign" sign-nested "${BUILD_DIR}/${TEST_UUID}.exe" "${ORG_CERT_FILE}" "${SECONDARY_CERT}"
else
    print_step "5/7" "Signing main binary..."
    "${PROJECT_ROOT}/utils/codesign" sign "${BUILD_DIR}/${TEST_UUID}.exe"
fi
print_success "Main binary signed"

# Step 6: Cleanup stage binaries
print_step "6/7" "Cleaning up..."
cd "${TEST_DIR}"
for stage_def in "${STAGES[@]}"; do
    IFS=':' read -r _ source_file <<< "$stage_def"
    rm -f "${source_file}.exe"
done
rm -f es_config.go
print_success "Cleanup complete"

# Step 7: Calculate hashes
print_step "7/7" "Calculating SHA1 hash..."
main_hash=$(shasum -a 1 "${BUILD_DIR}/${TEST_UUID}.exe" | awk '{print $1}')
final_size=$(ls -lh "${BUILD_DIR}/${TEST_UUID}.exe" | awk '{print $5}')

# ==============================================================================
# BUILD SUMMARY
# ==============================================================================

print_header "Build Complete"
echo ""
echo "  Test UUID:     ${TEST_UUID}"
echo "  Test Name:     LimaCharlie Timeout Validation Harness"
echo "  Stages:        ${stage_count}"
echo "  Runtime:       ~6 minutes (3 stages x 2 min each)"
echo "  Final Binary:  ${BUILD_DIR}/${TEST_UUID}.exe"
echo "  Binary Size:   ${final_size}"
echo "  SHA1 Hash:     ${main_hash}"
echo ""
echo "Stage Details:"
for stage_def in "${STAGES[@]}"; do
    IFS=':' read -r stage_num source_file <<< "$stage_def"
    echo "  - Stage ${stage_num}: 2 minute wait (${source_file}.go)"
done
echo ""
print_success "Ready for deployment!"
echo ""
echo "LimaCharlie Timeout Test:"
echo "  1. Deploy to endpoint"
echo "  2. Run: limacharlie sensors task <sid> \"run --payload-name <payload> --timeout 420\""
echo "  3. Check RECEIPT event for exit code 101 (not 259)"
echo ""
