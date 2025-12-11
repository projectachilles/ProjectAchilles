#!/bin/bash
# Build script for MDE Process Injection and API Authentication Bypass test
# Creates a single self-contained binary with all embedded components

set -e

TEST_UUID="fec68e9b-af59-40c1-abbd-98ec98428444"
TEST_DIR="tests_source/${TEST_UUID}"
BUILD_DIR="build/${TEST_UUID}"

echo "==================================================================="
echo "Building: MDE Process Injection and API Authentication Bypass"
echo "UUID: ${TEST_UUID}"
echo "Target: Single self-contained Windows binary"
echo "==================================================================="
echo ""

# Navigate to test directory
cd "${TEST_DIR}"

echo "[1/3] Building watchdog binary..."
echo "  -> mde_process_watchdog.exe"
GOOS=windows GOARCH=amd64 go build -o mde_process_watchdog.exe mde_process_watchdog.go

if [ ! -f "mde_process_watchdog.exe" ]; then
    echo "ERROR: Watchdog build failed"
    exit 1
fi

WATCHDOG_SIZE=$(wc -c < mde_process_watchdog.exe)
echo "  -> Built successfully ($WATCHDOG_SIZE bytes)"
echo ""

echo "[2/3] Building main test binary with embedded components..."
echo "  -> Components to embed:"
echo "     - mde_process_watchdog.exe ($WATCHDOG_SIZE bytes)"
echo "     - emergency_restore.ps1"
echo ""
echo "  -> Compiling main binary..."

# Build main binary with all Go source files
GOOS=windows GOARCH=amd64 go build \
    -o "../../${BUILD_DIR}/${TEST_UUID}.exe" \
    "${TEST_UUID}.go" \
    test_logger.go \
    process_injection.go \
    memory_patcher.go \
    api_interceptor.go

if [ ! -f "../../${BUILD_DIR}/${TEST_UUID}.exe" ]; then
    echo "ERROR: Main binary build failed"
    rm -f mde_process_watchdog.exe
    exit 1
fi

BINARY_SIZE=$(wc -c < "../../${BUILD_DIR}/${TEST_UUID}.exe")
echo "  -> Built successfully ($BINARY_SIZE bytes)"
echo ""

echo "[3/3] Cleaning up temporary files..."
rm -f mde_process_watchdog.exe
echo "  -> Temporary files removed"
echo ""

# Return to root
cd ../..

echo "==================================================================="
echo "BUILD COMPLETE!"
echo "==================================================================="
echo ""
echo "Output: ${BUILD_DIR}/${TEST_UUID}.exe"
echo "Size: $(numfmt --to=iec-i --suffix=B $BINARY_SIZE)"
echo ""
echo "This single binary contains:"
echo "  ✓ Main test logic (5 phases implemented)"
echo "  ✓ Process injection module"
echo "  ✓ Memory patching module"
echo "  ✓ API interceptor module"
echo "  ✓ Comprehensive logging"
echo "  ✓ Embedded watchdog binary"
echo "  ✓ Embedded emergency recovery script"
echo ""
echo "⚠️  SAFETY REMINDER:"
echo "  - Read SAFETY_GUIDE.md before executing"
echo "  - Requires Administrator privileges"
echo "  - Requires MDE to be installed"
echo "  - Run in isolated lab environment only"
echo ""
echo "Next steps:"
echo "  1. Optional: Sign the binary"
echo "     ./utils/codesign sign ${BUILD_DIR}/${TEST_UUID}.exe"
echo ""
echo "  2. Deploy to test system"
echo "     scp ${BUILD_DIR}/${TEST_UUID}.exe target-host:C:\\"
echo ""
echo "  3. Execute (as Administrator)"
echo "     C:\\${TEST_UUID}.exe"
echo ""
