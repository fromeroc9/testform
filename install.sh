#!/usr/bin/env bash
set -e

echo "Instalando Testform vía NPM..."

if ! command -v npm &> /dev/null; then
    echo "Error: npm no está instalado. Por favor instala Node.js primero."
    exit 1
fi

npm install -g testform

echo ""
echo "✅ ¡Testform se ha instalado correctamente!"
echo "Verificando instalación:"
testform version
