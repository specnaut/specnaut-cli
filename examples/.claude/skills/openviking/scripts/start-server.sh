#!/bin/bash
# Démarrage automatique du serveur OpenViking en arrière-plan

echo "🔍 Vérification du statut du serveur OpenViking..."

if curl -s http://localhost:1933/api/v1/observer/system > /dev/null; then
    echo "✅ Le serveur OpenViking est déjà en cours d'exécution."
else
    echo "🚀 Démarrage du serveur OpenViking en tâche de fond..."
    mkdir -p ~/.openviking
    export PATH="$HOME/.local/bin:$PATH"
    nohup openviking-server > ~/.openviking/server.log 2>&1 &
    
    # Attendre que le serveur soit prêt
    max_retries=10
    count=0
    while ! curl -s http://localhost:1933/api/v1/observer/system > /dev/null && [ $count -le $max_retries ]; do
        sleep 1
        count=$((count+1))
    done
    
    if [ $count -gt $max_retries ]; then
        echo "❌ Échec du démarrage du serveur."
        exit 1
    fi
    echo "✅ Serveur démarré avec succès !"
fi
