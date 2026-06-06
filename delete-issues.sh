#!/bin/bash

# Este script utiliza el CLI de GitHub (gh) para obtener todos los issues 
# del repositorio actual y eliminarlos permanentemente.
# Requiere tener instalado y autenticado `gh` (GitHub CLI)
# con permisos de administrador en el repositorio.

REPO=$1

if [ -z "$REPO" ]; then
    echo "Uso: ./delete-issues.sh <owner/repo>"
    echo "Ejemplo: ./delete-issues.sh username/repo"
    exit 1
fi

echo "⚠️  ADVERTENCIA: Esto eliminará PERMANENTEMENTE todos los issues del repositorio '$REPO'."
echo "Presiona Ctrl+C en los próximos 5 segundos para cancelar..."
sleep 5

echo "Buscando issues en $REPO..."

# Obtener todos los issues (abiertos y cerrados)
ISSUES=$(gh issue list --repo "$REPO" --state all --limit 1000 --json number --jq '.[].number')

if [ -z "$ISSUES" ]; then
    echo "✅ No se encontraron issues para eliminar en $REPO."
    exit 0
fi

for ISSUE in $ISSUES; do
    echo "🗑️  Eliminando issue #$ISSUE en $REPO..."
    gh issue delete "$ISSUE" --repo "$REPO" --yes
done

echo "✅ Todos los issues han sido eliminados con éxito en $REPO."
