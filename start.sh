#!/bin/bash
npm run build && NODE_ENV=production node dist/index.cjs
