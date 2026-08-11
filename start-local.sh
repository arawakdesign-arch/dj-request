#!/bin/bash

echo "=================================="
echo "     PULL UP! - Local"
echo "=================================="

if [ ! -d "node_modules" ]; then
    npm install
fi

if [ ! -f ".env" ]; then
    cp .env.example .env
    echo ""
    echo "Le fichier .env a été créé."
    echo "Complète les clés Supabase/Twilio si besoin."
fi

npm start