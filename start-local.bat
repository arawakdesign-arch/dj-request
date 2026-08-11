@echo off
title PULL UP! - Local

echo ==================================
echo      PULL UP! - Local
echo ==================================
echo.

if not exist node_modules (
    echo Installation des dependances...
    call npm install
)

if not exist .env (
    copy .env.example .env >nul
    echo.
    echo **********************************************
    echo Le fichier .env a ete cree.
    echo Complete les cles Supabase/Twilio si besoin.
    echo **********************************************
    echo.
)

echo Demarrage du serveur...
echo.

npm start

pause