@rem Do not echo commands.
@echo off
rem Keep variable changes local.
setlocal
rem Window title.
title GitLarp
rem Change to the folder of this file.
pushd "%~dp0"
rem Fail if the folder is unavailable.
if errorlevel 1 goto folder_error

rem Check that Node.js is installed.
where node >nul 2>&1
rem Jump to the error message if not.
if errorlevel 1 goto node_error
rem Check that Node.js is at least version 22.13.
node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit(major>22 || major===22 && minor>=13 ? 0 : 1)"
rem Jump to the error message if too old.
if errorlevel 1 goto node_error
rem Check that npm is installed.
where npm.cmd >nul 2>&1
rem Jump to the error message if not.
if errorlevel 1 goto node_error

rem This launcher always runs the local development app.
rem Development environment.
set "NODE_ENV=development"
rem Listen on localhost only.
set "HOST=127.0.0.1"
rem API port.
set "PORT=3001"
rem Address of the web app.
set "APP_URL=http://localhost:5173"
rem On first run, create .env.
if not exist ".env" (
  rem Tell the user.
  echo Preparing local settings...
  rem Copy .env.example to .env with a random session secret.
  node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; import {randomBytes} from 'node:crypto'; const template=readFileSync('.env.example','utf8'); writeFileSync('.env',template.replace('SESSION_SECRET=','SESSION_SECRET='+randomBytes(48).toString('hex')),{flag:'wx'});"
  rem Stop if that failed.
  if errorlevel 1 goto setup_error
)

rem Install dependencies if any key tool is missing.
if not exist "node_modules\.bin\vite.cmd" goto install
rem Check tsx.
if not exist "node_modules\.bin\tsx.cmd" goto install
rem Check concurrently.
if not exist "node_modules\.bin\concurrently.cmd" goto install
rem Check electron.
if not exist "node_modules\.bin\electron.cmd" goto install
rem Everything exists, skip installing.
goto ready

rem Install section.
:install
rem Tell the user.
echo Installing dependencies. The first run may take a minute...
rem Clean install including dev packages.
call npm ci --include=dev
rem Stop if the install failed.
if errorlevel 1 goto setup_error

rem Ready section.
:ready
rem With --check, only report readiness.
if /i "%~1"=="--check" (
  rem Message.
  echo GitLarp is ready to launch.
  rem Finish.
  goto done
)
rem Default: the desktop app. Use "run.bat --web" for the browser dev server.
rem With --web, run the browser dev server instead.
if /i "%~1"=="--web" goto web
rem Reuse the existing build unless it is missing or --rebuild is given. This makes launching much faster.
if /i "%~1"=="--rebuild" goto build
if not exist "dist\index.html" goto build
if not exist "server-dist\index.js" goto build
echo Opening the GitLarp app...
call npm run app:start
if errorlevel 1 goto launch_error
goto done

:build
echo Building and opening the GitLarp app...
call npm run app
rem Report a launch problem.
if errorlevel 1 goto launch_error
rem Finish.
goto done

rem Browser dev server section.
:web
rem Message.
echo Starting GitLarp at http://localhost:5173
rem Open the browser once the servers are ready.
start "" /b node scripts\open-browser.mjs
rem Run the API and web servers.
call npm run dev
rem Report a launch problem.
if errorlevel 1 goto launch_error
rem Finish.
goto done

rem Error: Node.js missing or too old.
:node_error
rem Message.
echo Please install Node.js 22.13 or newer, including npm, then run this file again.
rem Restart hint.
echo If you just installed Node.js, restart your terminal or sign out and back in.
rem Jump to the failure ending.
goto failed

rem Error: folder unavailable.
:folder_error
rem Message.
echo Could not open the GitLarp folder. Keep run.bat inside the app folder.
rem Wait for a key press.
pause
rem Exit with an error.
exit /b 1

rem Error: setup failed.
:setup_error
rem Message.
echo Setup failed. Check the message above and your internet connection, then try again.
rem Jump to the failure ending.
goto failed

rem Error: launch failed.
:launch_error
rem Message.
echo GitLarp stopped. If a port is already in use, close the other server and try again.
rem Jump to the failure ending.
goto failed

rem Failure ending.
:failed
rem Wait for a key press.
pause
rem Go back to the original folder.
popd
rem Exit with an error code.
exit /b 1

rem Success ending.
:done
rem Go back to the original folder.
popd
rem Exit with success.
exit /b 0
