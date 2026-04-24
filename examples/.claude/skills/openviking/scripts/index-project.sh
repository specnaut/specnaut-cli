#!/bin/bash
# Script d'indexation automatique du projet courant

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(pwd)"

echo "🔄 Initialisation de l'indexation pour : $PROJECT_DIR"

# Assurons-nous que le serveur tourne d'abord
$DIR/start-server.sh

if [ $? -eq 0 ]; then
    echo "📦 Envoi du projet à OpenViking (cela peut prendre du temps la première fois)..."
    ov add-resource "$PROJECT_DIR" --no-strict
    echo "✅ Indexation terminée / mise à jour."
else
    echo "❌ Impossible d'indexer car le serveur n'a pas pu démarrer."
    exit 1
fi
