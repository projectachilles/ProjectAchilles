#!/bin/bash
set -e

# ================================================================
# SilentButDeadly WFP EDR Network Isolation - Build Script
# Test ID: e5577355-f8e4-4e52-b1b2-f7d1c8b864f1
# ================================================================

TEST_UUID="e5577355-f8e4-4e52-b1b2-f7d1c8b864f1"
TEST_DIR="tests_source/${TEST_UUID}"
BUILD_DIR="build/${TEST_UUID}"

# Parse command-line arguments
ORG_CERT=""
USAGE="Usage: $0 [--org <org-identifier>]

Options:
  --org <org-identifier>    Organization for dual signing (UUID or short name)
                            Examples: sb, 09b59276-9efb-4d3d-bbdd-4b4663ef0c42
                            Available short names: sb, tpsgl, rga

Examples:
  $0                           # Use default organization from registry
  $0 --org sb                  # Use sb short name
  $0 --org 09b59276-9efb...    # Use UUID
"

while [[ $# -gt 0 ]]; do
    case $1 in
        --org)
            ORG_CERT="$2"
            shift 2
            ;;
        -h|--help)
            echo "$USAGE"
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option: $1"
            echo "$USAGE"
            exit 1
            ;;
    esac
done

# Determine script location and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source organization registry helper
RESOLVE_ORG_SCRIPT="${PROJECT_ROOT}/utils/resolve_org.sh"
if [ -f "${RESOLVE_ORG_SCRIPT}" ]; then
    source "${RESOLVE_ORG_SCRIPT}"
else
    echo "ERROR: Organization registry helper not found: ${RESOLVE_ORG_SCRIPT}"
    exit 1
fi

# Resolve organization to certificate file using registry
CERT_FILE=$(resolve_org_to_cert "$ORG_CERT")
if [ $? -ne 0 ] || [ -z "$CERT_FILE" ]; then
    echo "ERROR: Could not resolve organization '$ORG_CERT' to certificate"
    list_organizations
    exit 1
fi

# Set certificate paths
ORG_CERT_FILE="${PROJECT_ROOT}/signing-certs/${CERT_FILE}"
ORG_CERT_FILE_RELATIVE="../../signing-certs/${CERT_FILE}"  # For use from test directory

# Verify certificate file exists
if [ ! -f "${ORG_CERT_FILE}" ]; then
    echo "ERROR: Certificate file not found: ${ORG_CERT_FILE}"
    exit 1
fi

echo "================================================================="
echo "Building Test: SilentButDeadly WFP EDR Network Isolation"
echo "Test ID: ${TEST_UUID}"
echo "Organization: ${ORG_CERT:-default}"
echo "Certificate: ${CERT_FILE}"
echo "================================================================="
echo ""

# Verify required files exist
echo "Verifying required files..."
cd "${PROJECT_ROOT}/${TEST_DIR}"

if [ ! -f "sbd-f0rt1ka.exe" ]; then
    echo "ERROR: sbd-f0rt1ka.exe not found in ${TEST_DIR}"
    echo "Please ensure the binary is in the test directory"
    exit 1
fi

SILENTBUTDEADLY_SIZE=$(ls -lh "sbd-f0rt1ka.exe" | awk '{print $5}')
echo "  ✓ sbd-f0rt1ka.exe found (${SILENTBUTDEADLY_SIZE})"
echo ""

# Step 1: Sign embedded binary (BEFORE building main binary)
echo "[Step 1/5] Dual-signing embedded sbd-f0rt1ka.exe (${ORG_CERT:-default} + F0RT1KA)..."
echo ""

../../utils/codesign sign-nested "sbd-f0rt1ka.exe" "${ORG_CERT_FILE_RELATIVE}" ../../signing-certs/F0RT1KA.pfx

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to sign sbd-f0rt1ka.exe"
    exit 1
fi

echo "    ✓ sbd-f0rt1ka.exe dual-signed"
echo ""

# Step 2: Verify embedded binary signature
echo "[Step 2/5] Verifying embedded binary signature..."
echo ""

osslsigncode verify "sbd-f0rt1ka.exe" 2>&1 | grep -q "Message digest"

if [ $? -ne 0 ]; then
    echo "ERROR: Signature verification failed for sbd-f0rt1ka.exe"
    exit 1
fi

echo "    ✓ sbd-f0rt1ka.exe signature valid"
echo ""

# Step 3: Build main binary (embeds SIGNED sbd-f0rt1ka.exe)
echo "[Step 3/5] Building main binary (embedding signed sbd-f0rt1ka.exe)..."
echo ""

cd "${PROJECT_ROOT}"
mkdir -p "${BUILD_DIR}"

cd "${TEST_DIR}"
echo "  Building ${TEST_UUID}.exe..."
GOOS=windows GOARCH=amd64 go build -o "../../${BUILD_DIR}/${TEST_UUID}.exe" "${TEST_UUID}.go" test_logger.go org_resolver.go

if [ ! -f "../../${BUILD_DIR}/${TEST_UUID}.exe" ]; then
    echo "ERROR: Failed to build main binary"
    exit 1
fi

MAIN_SIZE=$(ls -lh "../../${BUILD_DIR}/${TEST_UUID}.exe" | awk '{print $5}')
echo "    ✓ Main binary created (${MAIN_SIZE})"
echo ""

cd "${PROJECT_ROOT}"

# Step 4: Dual-sign main binary
echo "[Step 4/5] Dual-signing main binary (${ORG_CERT:-default} + F0RT1KA)..."
echo ""

./utils/codesign sign-nested "${BUILD_DIR}/${TEST_UUID}.exe" "${ORG_CERT_FILE}" signing-certs/F0RT1KA.pfx

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to sign main binary"
    exit 1
fi

echo "    ✓ Main binary dual-signed"
echo ""

# Step 5: Calculate SHA1 hashes and display results
echo "[Step 5/5] Calculating SHA1 hashes..."
echo ""

cd "${TEST_DIR}"
EMBEDDED_HASH=$(shasum -a 1 "sbd-f0rt1ka.exe" | awk '{print $1}')
cd "${PROJECT_ROOT}"
MAIN_HASH=$(shasum -a 1 "${BUILD_DIR}/${TEST_UUID}.exe" | awk '{print $1}')

# Show results
echo ""
echo "================================================================="
echo "Build Complete!"
echo "================================================================="
echo ""
echo "Test Binary:"
ls -lh "${BUILD_DIR}/${TEST_UUID}.exe"
echo ""
echo "Signing:"
echo "  ✓ All binaries dual-signed (${ORG_CERT:-default} org cert + F0RT1KA)"
echo "  ✓ Embedded binary: sbd-f0rt1ka.exe"
echo "  ✓ Main binary: ${TEST_UUID}.exe"
echo ""
echo "SHA1 Hashes:"
echo "  Main Binary:"
echo "    ${TEST_UUID}.exe: ${MAIN_HASH}"
echo ""
echo "  Embedded Binary:"
echo "    sbd-f0rt1ka.exe: ${EMBEDDED_HASH}"
echo ""
echo "Deployment:"
echo "  1. Copy ${TEST_UUID}.exe to target system"
echo "  2. Run as Administrator: ${TEST_UUID}.exe"
echo "  3. Test requires elevated privileges for WFP access"
echo ""
echo "Expected Exit Codes:"
echo "  101 - EDR network isolation successful (system unprotected)"
echo "  105 - SilentButDeadly.exe quarantined (protected)"
echo "  126 - Execution prevented by EDR (protected)"
echo "  999 - Test error (prerequisites not met)"
echo ""
echo "================================================================="
