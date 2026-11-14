@echo off
chcp 65001 >nul
echo ============================================================================
echo   ระบบติดตั้ง GitHub Pages และ GitHub Actions อัตโนมัติ (Parcel Registration System)
echo ============================================================================
echo.

if not exist ".github\workflows" mkdir ".github\workflows"
if not exist "public" mkdir "public"
type nul > "public\.nojekyll"

(
echo name: Deploy Student Parcel System to GitHub Pages
echo.
echo on:
echo   push:
echo     branches:
echo       - main
echo       - master
echo   workflow_dispatch:
echo.
echo permissions:
echo   contents: read
echo   pages: write
echo   id-token: write
echo.
echo concurrency:
echo   group: "pages"
echo   cancel-in-progress: true
echo.
echo jobs:
echo   build:
echo     runs-on: ubuntu-latest
echo     steps:
echo       - name: 1. Checkout Source Code
echo         uses: actions/checkout@v4
echo.
echo       - name: 2. Setup Node.js Environment
echo         uses: actions/setup-node@v4
echo         with:
echo           node-version: 22
echo.
echo       - name: 3. Install Dependencies
echo         run: npm install --legacy-peer-deps ^|^| npm install --force
echo.
echo       - name: 4. Build Production Bundle ^(Vite + React + Tailwind^)
echo         run: ^|
echo           npm run build
echo           touch dist/.nojekyll
echo           cp dist/index.html dist/404.html
echo.
echo       - name: 5. Configure GitHub Pages
echo         uses: actions/configure-pages@v5
echo         with:
echo           enablement: true
echo.
echo       - name: 6. Upload Build Artifact ^(dist/^)
echo         uses: actions/upload-pages-artifact@v3
echo         with:
echo           path: './dist'
echo.
echo   deploy:
echo     environment:
echo       name: github-pages
echo       url: ${{ steps.deployment.outputs.page_url }}
echo     runs-on: ubuntu-latest
echo     needs: build
echo     steps:
echo       - name: Deploy to GitHub Pages
echo         id: deployment
echo         uses: actions/deploy-pages@v4
) > ".github\workflows\deploy.yml"

echo [สำเร็จ] สร้างไฟล์ .github\workflows\deploy.yml และ public\.nojekyll เรียบร้อยแล้ว!
echo.

set /p REPO_URL="กรุณาวาง URL ของ GitHub Repository (เช่น https://github.com/username/parcel-system.git หรือกด Enter เพื่อข้าม): "

if "%REPO_URL%"=="" (
    goto END
)

git init
git add .
git commit -m "Fix GitHub Actions workflow for GitHub Pages"
git branch -M main
git remote remove origin 2>nul
git remote add origin %REPO_URL%
git push -u origin main

:END
pause
