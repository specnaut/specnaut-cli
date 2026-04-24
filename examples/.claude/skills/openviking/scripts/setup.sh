#!/bin/bash
# Script d'installation et de configuration rapide pour OpenViking

echo "🚀 Initialisation de OpenViking..."

# Création du dossier de configuration
mkdir -p ~/.openviking
WORKSPACE_DIR="$HOME/openviking_workspace"
mkdir -p "$WORKSPACE_DIR"

# Vérification et création du fichier ov.conf
if [ ! -f ~/.openviking/ov.conf ]; then
  echo "🔑 Configuration initiale requise."
  read -s -p "Veuillez entrer votre clé API OpenAI (sk-...) : " OPENAI_API_KEY
  echo ""

  cat <<EOF > ~/.openviking/ov.conf
{
  "storage": {
    "workspace": "$WORKSPACE_DIR"
  },
  "log": {
    "level": "INFO",
    "output": "stdout"
  },
  "embedding": {
    "dense": {
      "api_base" : "https://api.openai.com/v1",
      "api_key"  : "$OPENAI_API_KEY",
      "provider" : "openai",
      "dimension": 3072,
      "model"    : "text-embedding-3-large"
    },
    "max_concurrent": 10
  },
  "vlm": {
    "api_base" : "https://api.openai.com/v1",
    "api_key"  : "$OPENAI_API_KEY",
    "provider" : "openai",
    "model"    : "gpt-4o-mini",
    "max_concurrent": 100
  }
}
EOF
  echo "✅ Configuration serveur créée : ~/.openviking/ov.conf"
else
  echo "✅ Configuration serveur déjà existante : ~/.openviking/ov.conf"
fi

# Création du fichier client ovcli.conf
cat <<EOF > ~/.openviking/ovcli.conf
{
  "url": "http://localhost:1933",
  "timeout": 60.0,
  "output": "table"
}
EOF
echo "✅ Configuration client mise à jour : ~/.openviking/ovcli.conf"

echo ""
echo "--------------------------------------------------------"
echo "🎉 OpenViking est prêt à être utilisé !"
echo "--------------------------------------------------------"
echo "Pour démarrer la mémoire sur ce projet, suivez ces 2 étapes :"
echo ""
echo "1. Ouvrez un TTY/Terminal séparé et lancez le serveur en fond :"
echo "   openviking-server"
echo ""
echo "2. Dans ce terminal actuel, indexez ce projet :"
echo "   ov add-resource \$(pwd)"
echo "--------------------------------------------------------"
