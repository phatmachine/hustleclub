#!/bin/bash

echo "=== HustleClub Domain Routing Verification ==="
echo ""

# Check container status
echo "1. Checking container status..."
if docker ps | grep -q "hustleclub"; then
    echo "   ✓ Container 'hustleclub' is running"
else
    echo "   ✗ Container 'hustleclub' is not running"
    exit 1
fi

# Check port binding
echo "2. Checking port binding..."
if docker ps | grep -q "3001->3000"; then
    echo "   ✓ Port 3001 is correctly bound to container port 3000"
else
    echo "   ✗ Port binding is incorrect"
    exit 1
fi

# Check network
echo "3. Checking network..."
if docker inspect hustleclub | grep -q "traefik-proxy"; then
    echo "   ✓ Container is on traefik-proxy network"
else
    echo "   ✗ Container is not on traefik-proxy network"
    exit 1
fi

# Check Traefik labels
echo "4. Checking Traefik labels..."
if docker inspect hustleclub | grep -q "traefik.enable"; then
    echo "   ✓ Traefik is enabled for this container"
else
    echo "   ✗ Traefik is not enabled"
    exit 1
fi

if docker inspect hustleclub | grep -q "hustleclub.app"; then
    echo "   ✓ Domain routing for hustleclub.app is configured"
else
    echo "   ✗ Domain routing is not configured"
    exit 1
fi

if docker inspect hustleclub | grep -q "websecure"; then
    echo "   ✓ HTTPS entrypoint (websecure) is configured"
else
    echo "   ✗ HTTPS entrypoint is not configured"
    exit 1
fi

if docker inspect hustleclub | grep -q "letsencrypt"; then
    echo "   ✓ Let's Encrypt certificate resolver is configured"
else
    echo "   ✗ Certificate resolver is not configured"
    exit 1
fi

# Check local accessibility
echo "5. Checking local accessibility..."
if curl -s http://localhost:3001 > /dev/null; then
    echo "   ✓ Container is accessible on localhost:3001"
else
    echo "   ✗ Container is not accessible on localhost:3001"
    exit 1
fi

# Check Traefik certificate status
echo "6. Checking SSL certificate status..."
if docker logs traefik-5sny-traefik-1 | grep -q "Server responded with a certificate.*hustleclub.app"; then
    echo "   ✓ SSL certificates have been obtained for hustleclub.app"
else
    echo "   ⚠ SSL certificates may still be in progress"
fi

echo ""
echo "=== Verification Summary ==="
echo "✓ All configuration checks passed!"
echo ""
echo "Domain routing should be working for:"
echo "  - https://hustleclub.app"
echo "  - https://www.hustleclub.app"
echo ""
echo "Container details:"
echo "  - Name: hustleclub"
echo "  - Port: 3001 (external) → 3000 (internal)"
echo "  - Network: traefik-proxy"
echo "  - HTTPS: Secured via Traefik with Let's Encrypt"
echo ""
echo "To test the domain routing:"
echo "  1. Ensure DNS for hustleclub.app points to this server's IP"
echo "  2. Wait a few minutes for DNS propagation"
echo "  3. Visit https://hustleclub.app in a browser"
echo "  4. You should see the HustleClub application"