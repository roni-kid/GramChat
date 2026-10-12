@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo Gramchat GitHub push helper
echo ==========================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or is not available in PATH.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js/npm is not installed or is not available in PATH.
  exit /b 1
)

if not exist ".git" (
  echo ERROR: This script must be run from the Gramchat Git repository.
  exit /b 1
)

call :require_file "package.json" || exit /b 1
call :require_file "package-lock.json" || exit /b 1
call :require_file "README.md" || exit /b 1
call :require_file "CHANGELOG.md" || exit /b 1
call :require_file "backend\package.json" || exit /b 1
call :require_file "backend\package-lock.json" || exit /b 1
call :require_file "backend\.env.example" || exit /b 1
call :require_file "frontend\package.json" || exit /b 1
call :require_file "frontend\package-lock.json" || exit /b 1
call :require_file "frontend\.env.example" || exit /b 1
call :require_file ".gitignore" || exit /b 1

echo Checking Git remote...
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo ERROR: No Git remote named origin is configured.
  echo Add it with:
  echo   git remote add origin https://github.com/roni-kid/Gramchat.git
  exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not defined BRANCH (
  echo ERROR: Could not detect the current Git branch.
  exit /b 1
)

echo.
echo Running frontend build check...
npm run build --prefix frontend
if errorlevel 1 (
  echo.
  echo ERROR: Frontend build failed. Fix the build before pushing.
  exit /b 1
)

echo.
echo Staging changes...
git add -A
if errorlevel 1 (
  echo ERROR: Failed to stage changes.
  exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo No staged changes to commit.
  exit /b 0
)

echo.
echo Files staged for commit:
git diff --cached --name-status

set "COMMIT_MESSAGE=%*"
if "%COMMIT_MESSAGE%"=="" (
  set /p "COMMIT_MESSAGE=Commit message: "
)
if "%COMMIT_MESSAGE%"=="" (
  set "COMMIT_MESSAGE=Update Gramchat"
)

echo.
echo Committing changes...
git commit -m "%COMMIT_MESSAGE%"
if errorlevel 1 (
  echo ERROR: Commit failed.
  exit /b 1
)

echo.
echo Pushing branch %BRANCH% to origin...
git push -u origin "%BRANCH%"
if errorlevel 1 (
  echo ERROR: Push failed.
  exit /b 1
)

echo.
echo Push complete.
exit /b 0

:require_file
if not exist "%~1" (
  echo ERROR: Required file missing: %~1
  exit /b 1
)
exit /b 0
