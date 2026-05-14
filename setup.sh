#!/bin/bash

echo "====================================="
echo " Setting up KithLy Docker Environment"
echo "====================================="

# Check if .env file exists, if not warn the user
if [ ! -f .env ]; then
  echo "Warning: .env file not found in the root directory."
  echo "Please ensure you have a .env file containing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  echo "Proceeding with build (variables can be injected later)..."
else
  echo ".env file detected. Environment variables will be loaded during build."
fi

# Build and start the containers in detached mode
echo "Building and starting Docker containers..."
docker compose up --build -d

echo "====================================="
echo " Success! KithLy is now running."
echo " Access the application at: http://localhost:8080"
echo "====================================="
