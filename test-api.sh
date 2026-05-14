#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "=== Overview ==="
curl -s http://localhost:3001/api/v1/performance/overview -H "Authorization: Bearer $TOKEN"
echo ""
echo "=== Ranking ==="
curl -s "http://localhost:3001/api/v1/performance/ranking?year=2025&month=5" -H "Authorization: Bearer $TOKEN"
echo ""
echo "=== Trend ==="
curl -s "http://localhost:3001/api/v1/performance/trend?months=6" -H "Authorization: Bearer $TOKEN"
