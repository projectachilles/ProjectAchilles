@echo off
REM Build script for MDE Authentication Bypass test supporting tools
REM Run this to compile the helper binaries before building the main test

echo Building supporting binaries for MDE Authentication Bypass test...
echo.

echo [1/2] Building fake_mssense.exe...
go build -o fake_mssense.exe fake_mssense.go
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to build fake_mssense.exe
    exit /b 1
)
echo SUCCESS: fake_mssense.exe built

echo [2/2] Building isolation_spoofer.exe...
go build -o isolation_spoofer.exe isolation_spoofer.go
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to build isolation_spoofer.exe
    exit /b 1
)
echo SUCCESS: isolation_spoofer.exe built

echo.
echo All supporting binaries built successfully!
echo Next steps:
echo 1. Run gobuild from root: ./utils/gobuild build tests_source/b6c73735-0c24-4a1e-8f0a-3c24af39671b/
echo 2. Sign the binary: ./utils/codesign sign build/b6c73735-0c24-4a1e-8f0a-3c24af39671b/b6c73735-0c24-4a1e-8f0a-3c24af39671b.exe