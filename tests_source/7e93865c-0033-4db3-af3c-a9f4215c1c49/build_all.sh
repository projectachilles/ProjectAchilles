#!/bin/bash
# Build script for Process Injection via CreateRemoteThread test
# Single-binary deployment - no external dependencies

set -e

TEST_UUID="7e93865c-0033-4db3-af3c-a9f4215c1c49"
TEST_NAME="Process Injection via CreateRemoteThread"

echo "============================================="
echo "Building: ${TEST_NAME}"
echo "UUID: ${TEST_UUID}"
echo "============================================="
echo ""

# Navigate to test directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "${SCRIPT_DIR}"

# Ensure build directory exists
mkdir -p "../../build/${TEST_UUID}"

echo "[1/3] Building test binary..."
# Build single binary with both main test and logger
GOOS=windows GOARCH=amd64 go build -o "../../build/${TEST_UUID}/${TEST_UUID}.exe" \
    "${TEST_UUID}.go" test_logger.go

if [ $? -eq 0 ]; then
    echo "    ✓ Binary compiled successfully"
else
    echo "    ✗ Build failed"
    exit 1
fi

# Get file size
if [ -f "../../build/${TEST_UUID}/${TEST_UUID}.exe" ]; then
    FILESIZE=$(ls -lh "../../build/${TEST_UUID}/${TEST_UUID}.exe" | awk '{print $5}')
    echo "    ✓ Binary size: ${FILESIZE}"
fi

echo ""
echo "[2/3] Signing binary..."
cd ../..
./utils/codesign sign "build/${TEST_UUID}/${TEST_UUID}.exe"

echo ""
echo "[3/3] Build complete!"
echo ""
echo "============================================="
echo "SINGLE BINARY READY FOR DEPLOYMENT:"
echo "build/${TEST_UUID}/${TEST_UUID}.exe"
echo ""
echo "To deploy:"
echo "  1. Copy the single .exe file to target system"
echo "  2. Run with administrator privileges"
echo "  3. Test will auto-install certificate if needed"
echo "============================================="