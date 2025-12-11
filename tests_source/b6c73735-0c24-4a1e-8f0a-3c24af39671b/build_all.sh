#!/bin/bash
# build_all.sh - Build all components for MDE Authentication Bypass test
# This script builds the main test, watchdog, and all helper binaries

set -e  # Exit on error

echo "=========================================="
echo "F0RT1KA MDE Bypass Test - Build Script"
echo "=========================================="
echo ""

# Get the test directory
TEST_UUID="b6c73735-0c24-4a1e-8f0a-3c24af39671b"
TEST_DIR="tests_source/${TEST_UUID}"
BUILD_DIR="build/${TEST_UUID}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}[INFO]${NC} Building SINGLE-BINARY deployment with embedded components"
echo ""

# Step 1: Build helper binaries
echo -e "${BLUE}[1/5]${NC} Building helper binaries..."
echo ""

cd "${TEST_DIR}"

echo -e "  ${BLUE}→${NC} Building MsSense.exe (impersonation test)..."
GOOS=windows GOARCH=amd64 go build -o MsSense.exe fake_mssense.go
echo -e "  ${GREEN}✓${NC} MsSense.exe built"

echo -e "  ${BLUE}→${NC} Building isolation_spoofer.exe..."
GOOS=windows GOARCH=amd64 go build -o isolation_spoofer.exe isolation_spoofer.go
echo -e "  ${GREEN}✓${NC} isolation_spoofer.exe built"

echo -e "  ${BLUE}→${NC} Building cert_bypass_watchdog.exe..."
GOOS=windows GOARCH=amd64 go build -o cert_bypass_watchdog.exe cert_bypass_watchdog.go
echo -e "  ${GREEN}✓${NC} cert_bypass_watchdog.exe built"

cd - > /dev/null

echo ""
echo -e "${GREEN}[SUCCESS]${NC} All helper binaries built"
echo ""

# Step 2: Prepare components for embedding
echo -e "${BLUE}[2/5]${NC} Preparing components for embedding..."
echo ""

# Helper binaries are already in TEST_DIR from step 1
# emergency_restore.ps1 is already there
echo -e "  ${BLUE}→${NC} Verifying embed sources..."
echo -e "  ${GREEN}✓${NC} MsSense.exe ($(du -h ${TEST_DIR}/MsSense.exe | cut -f1))"
echo -e "  ${GREEN}✓${NC} isolation_spoofer.exe ($(du -h ${TEST_DIR}/isolation_spoofer.exe | cut -f1))"
echo -e "  ${GREEN}✓${NC} cert_bypass_watchdog.exe ($(du -h ${TEST_DIR}/cert_bypass_watchdog.exe | cut -f1))"
echo -e "  ${GREEN}✓${NC} emergency_restore.ps1 ($(du -h ${TEST_DIR}/emergency_restore.ps1 | cut -f1))"

echo ""
echo -e "${GREEN}[SUCCESS]${NC} All components ready for embedding"
echo ""

# Step 3: Build single self-contained binary
echo -e "${BLUE}[3/5]${NC} Building single self-contained binary with all components embedded..."
echo ""

mkdir -p "${BUILD_DIR}"

cd "${TEST_DIR}"
echo -e "  ${BLUE}→${NC} Compiling with embedded components and all modules..."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o ../../build/b6c73735-0c24-4a1e-8f0a-3c24af39671b/b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe \
    b6c73735-0c24-4a1e-8f0a-3c24af39671b.go \
    test_logger.go \
    mde_identifier_extractor.go \
    cert_pinning_bypass.go \
    mde_network_tester.go
BUILD_RESULT=$?
cd ../..

if [ $BUILD_RESULT -eq 0 ]; then
    BINARY_SIZE=$(du -h "${BUILD_DIR}/${TEST_UUID}.exe" | cut -f1)
    echo -e "  ${GREEN}✓${NC} Single binary built: ${BINARY_SIZE}"
    echo ""
    echo -e "${GREEN}[SUCCESS]${NC} Self-contained binary created with logging + embedded components"
else
    echo ""
    echo -e "${YELLOW}[ERROR]${NC} Main test build failed"
    exit 1
fi

echo ""

# Step 4: Clean up temporary files from source directory
echo -e "${BLUE}[4/5]${NC} Cleaning up temporary build artifacts..."
echo ""

echo -e "  ${BLUE}→${NC} Removing temporary binaries from source..."
rm -f "${TEST_DIR}/MsSense.exe"
rm -f "${TEST_DIR}/isolation_spoofer.exe"
rm -f "${TEST_DIR}/cert_bypass_watchdog.exe"
echo -e "  ${GREEN}✓${NC} Cleanup complete"

echo ""

# Step 5: Copy documentation to build directory
echo -e "${BLUE}[5/5]${NC} Copying documentation files..."
echo ""

echo -e "  ${BLUE}→${NC} Copying reference documentation..."
cp "${TEST_DIR}/CERT_BYPASS_SAFETY_GUIDE.md" "${BUILD_DIR}/" 2>/dev/null || true
cp "${TEST_DIR}/RECOVERY_ARCHITECTURE.md" "${BUILD_DIR}/" 2>/dev/null || true
cp "${TEST_DIR}/LOGGING_GUIDE.md" "${BUILD_DIR}/" 2>/dev/null || true
cp "${TEST_DIR}/README.md" "${BUILD_DIR}/" 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} Documentation copied"

echo ""
echo -e "${GREEN}[SUCCESS]${NC} Documentation files available in build directory"
echo ""

# Build Summary
echo "=========================================="
echo -e "${BLUE}BUILD SUMMARY${NC}"
echo "=========================================="
echo ""
echo "Build directory: ${BUILD_DIR}"
echo ""
echo "Deployment file (SINGLE BINARY):"
MAIN_BINARY_SIZE=$(du -h "${BUILD_DIR}/${TEST_UUID}.exe" | cut -f1)
echo -e "  ${GREEN}✓${NC} ${TEST_UUID}.exe  (${MAIN_BINARY_SIZE})"
echo ""
echo "Embedded components (auto-extracted at runtime):"
echo "  • cert_bypass_watchdog.exe (3.1M) - Safety monitoring"
echo "  • emergency_restore.ps1 (12K) - Manual recovery"
echo "  • MsSense.exe (2.7M) - Impersonation test (mimics real MDE sensor)"
echo "  • isolation_spoofer.exe (2.7M) - Test component"
echo "  • mde_interceptor.ps1 (embedded) - Test component"
echo ""
echo "Reference documentation (build directory only):"
ls -lh "${BUILD_DIR}" | grep -E '\.md$' | awk '{printf "  - %s\n", $9}'

echo ""
echo "=========================================="
echo -e "${GREEN}BUILD COMPLETE - SINGLE BINARY READY${NC}"
echo "=========================================="
echo ""
echo "Deployment instructions:"
echo "  1. Copy ONLY the .exe file to target system:"
echo "     ${TEST_UUID}.exe"
echo ""
echo "  2. Optional: Sign the binary before deployment:"
echo "     ./utils/codesign sign ${BUILD_DIR}/${TEST_UUID}.exe"
echo ""
echo "  3. Run on target (components auto-extract to C:\\F0):"
echo "     ${TEST_UUID}.exe"
echo ""
echo "  4. Read safety documentation before advanced testing:"
echo "     cat ${BUILD_DIR}/CERT_BYPASS_SAFETY_GUIDE.md"
echo ""
echo "Note: The binary contains ALL runtime dependencies."
echo "      No additional files needed for deployment!"
echo ""
