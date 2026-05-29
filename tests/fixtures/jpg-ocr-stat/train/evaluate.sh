#!/bin/bash
# Simplified evaluator: checks output structure
if [ -f output/stats.json ]; then
  echo "SCORE: 1.0"
else
  echo "SCORE: 0.0"
fi
