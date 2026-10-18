function rgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const vals = [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16));
    return `rgba(${vals.join(',')},${alpha})`;
}
function roundedRectPath(ctx, x, y, w, h, rTL, rTR, rBR, rBL) {
    ctx.beginPath();
    ctx.moveTo(x + rTL, y);
    ctx.lineTo(x + w - rTR, y);
    if (rTR > 0)
        ctx.quadraticCurveTo(x + w, y, x + w, y + rTR);
    else
        ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - rBR);
    if (rBR > 0)
        ctx.quadraticCurveTo(x + w, y + h, x + w - rBR, y + h);
    else
        ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + rBL, y + h);
    if (rBL > 0)
        ctx.quadraticCurveTo(x, y + h, x, y + h - rBL);
    else
        ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + rTL);
    if (rTL > 0)
        ctx.quadraticCurveTo(x, y, x + rTL, y);
    else
        ctx.lineTo(x, y);
    ctx.closePath();
}
/** Material rendering is skin-data-driven; no puzzle rules depend on presentation. */
export function renderTile(ctx, skin, tile, x, y, primed, held, beat, flash, nearbyGlow = 0, edges = {}) {
    const u = 72;
    const c = skin.palette[tile.type];
    const pulse = primed ? (0.5 + 0.5 * Math.sin(beat * Math.PI * 8)) : 0;
    const basePad = primed ? 2.5 : 3.5;
    // When primed, adjacent tiles in the same group fuse seamlessly across their shared edges.
    const padT = primed && edges.top ? 0 : basePad;
    const padR = primed && edges.right ? 0 : basePad;
    const padB = primed && edges.bottom ? 0 : basePad;
    const padL = primed && edges.left ? 0 : basePad;
    const xx = x + padL;
    const yy = y + padT;
    const w = u - padL - padR;
    const h = u - padT - padB;
    const cx = x + 36;
    const cy = y + 36;
    const r = primed ? 7 : 6;
    const rTL = primed && (edges.top || edges.left) ? 0 : r;
    const rTR = primed && (edges.top || edges.right) ? 0 : r;
    const rBR = primed && (edges.bottom || edges.right) ? 0 : r;
    const rBL = primed && (edges.bottom || edges.left) ? 0 : r;
    ctx.save();
    // Subtle micro-connectors between unprimed same-color neighbors so clusters read at a glance
    if (!primed) {
        ctx.fillStyle = rgba(c, 0.26);
        if (edges.sameRight)
            ctx.fillRect(x + u - basePad - 1, cy - 10, basePad * 2 + 2, 20);
        if (edges.sameBottom)
            ctx.fillRect(cx - 10, y + u - basePad - 1, 20, basePad * 2 + 2);
    }
    // Outer glow for primed / held / neighbor-lit tiles
    if (primed || nearbyGlow > 0) {
        ctx.shadowBlur = primed ? (held ? 28 : 16) : nearbyGlow * 10;
        ctx.shadowColor = held ? '#ffffff' : c;
    }
    // Base block fill
    roundedRectPath(ctx, xx, yy, w, h, rTL, rTR, rBR, rBL);
    ctx.fillStyle = primed ? c : rgba(c, 0.86);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Clean tactile bevel sheen (inspired by 0.1.0's clean look, elevated)
    const sheen = ctx.createLinearGradient(xx, yy, xx + w * 0.6, yy + h);
    if (primed) {
        sheen.addColorStop(0, rgba('#ffffff', held ? 0.45 : 0.28 + pulse * 0.14));
        sheen.addColorStop(0.5, rgba('#ffffff', 0.05));
        sheen.addColorStop(1, rgba('#060712', 0.28));
    }
    else {
        sheen.addColorStop(0, '#ffffff30');
        sheen.addColorStop(0.42, '#ffffff04');
        sheen.addColorStop(1, '#06081468');
    }
    ctx.fillStyle = sheen;
    ctx.fill();
    // Top specular rim on unmerged top edges
    if (!edges.top) {
        ctx.fillStyle = primed ? rgba('#ffffff', held ? 0.65 : 0.42) : '#ffffff24';
        ctx.fillRect(xx + rTL * 0.7, yy + 1.5, Math.max(0, w - (rTL + rTR) * 0.7), primed ? 3 : 2);
    }
    // Subtle tone-on-tone engraved emblem (never loud white/black clutter)
    ctx.save();
    ctx.fillStyle = primed ? rgba('#060814', 0.22) : rgba('#060814', 0.2);
    ctx.strokeStyle = primed ? rgba('#ffffff', 0.35) : rgba('#ffffff', 0.16);
    ctx.lineWidth = 1.75;
    if (tile.type === 0) {
        // Diagonal slash
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy + 8);
        ctx.lineTo(cx + 8, cy - 10);
        ctx.lineTo(cx + 11, cy - 6);
        ctx.lineTo(cx - 7, cy + 11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    else if (tile.type === 1) {
        // Diamond
        ctx.beginPath();
        ctx.moveTo(cx, cy - 12);
        ctx.lineTo(cx + 12, cy);
        ctx.lineTo(cx, cy + 12);
        ctx.lineTo(cx - 12, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    else if (tile.type === 2) {
        // Ring
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
    }
    else {
        // Cross pip
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy - 9);
        ctx.lineTo(cx + 9, cy + 9);
        ctx.moveTo(cx + 9, cy - 9);
        ctx.lineTo(cx - 9, cy + 9);
        ctx.stroke();
        ctx.fillRect(cx - 3, cy - 3, 6, 6);
    }
    ctx.restore();
    // Unprimed crisp border
    if (!primed) {
        roundedRectPath(ctx, xx + 0.5, yy + 0.5, w - 1, h - 1, rTL, rTR, rBR, rBL);
        ctx.strokeStyle = nearbyGlow > 0 ? rgba(c, Math.min(0.65, 0.25 + nearbyGlow * 0.2)) : '#ffffff1e';
        ctx.lineWidth = nearbyGlow > 0 ? 1.5 : 1;
        ctx.stroke();
    }
    else {
        // Continuous outer perimeter border on exposed edges of the fused primed cluster
        ctx.strokeStyle = held ? '#ffffff' : rgba('#ffffff', 0.85 + pulse * 0.15);
        ctx.lineWidth = held ? 3 : 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (!edges.top) {
            ctx.moveTo(xx, yy + 1);
            ctx.lineTo(xx + w, yy + 1);
        }
        if (!edges.right) {
            ctx.moveTo(xx + w - 1, yy);
            ctx.lineTo(xx + w - 1, yy + h);
        }
        if (!edges.bottom) {
            ctx.moveTo(xx, yy + h - 1);
            ctx.lineTo(xx + w, yy + h - 1);
        }
        if (!edges.left) {
            ctx.moveTo(xx + 1, yy);
            ctx.lineTo(xx + 1, yy + h);
        }
        ctx.stroke();
        // If held (Overcharged), draw glowing inner energy frame & star marker
        if (held) {
            ctx.strokeStyle = rgba('#fff7d6', 0.6 + pulse * 0.35);
            ctx.lineWidth = 1.5;
            ctx.strokeRect(xx + 5, yy + 5, w - 10, h - 10);
            ctx.fillStyle = '#ffffff';
            ctx.font = '800 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('✦', cx, cy);
        }
        else if (edges.queued) {
            // Subtle corner indicator when queued behind the sweepline for the next pass
            ctx.fillStyle = '#ffffffcc';
            ctx.beginPath();
            ctx.arc(x + u - 11, y + 11, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}
export function renderSweep(ctx, skin, lineX, w, h, intensity, time) {
    if (skin.sweep === 'hidden')
        return;
    ctx.save();
    const accent = skin.accent;
    // Trailing wake gradient
    const wakeWidth = 78;
    const g = ctx.createLinearGradient(lineX - wakeWidth, 0, lineX + 6, 0);
    g.addColorStop(0, rgba(accent, 0));
    g.addColorStop(0.65, rgba(accent, 0.08 * intensity));
    g.addColorStop(0.92, rgba(accent, 0.28 * intensity));
    g.addColorStop(1, rgba('#ffffff', 0.55 * intensity));
    ctx.fillStyle = g;
    ctx.fillRect(lineX - wakeWidth, 0, wakeWidth + 6, h);
    // Subtle row-crossing ticks along the blade
    ctx.fillStyle = rgba('#ffffff', 0.35 * intensity);
    for (let y = 72; y < h; y += 72) {
        ctx.fillRect(lineX - 4, y - 1, 8, 2);
    }
    // Core laser blade
    ctx.shadowBlur = 14;
    ctx.shadowColor = accent;
    ctx.strokeStyle = skin.sweep === 'sunset' ? '#ffe0c2' : '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, h);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Playhead diamond cap at the top of the blade
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(lineX, 2);
    ctx.lineTo(lineX + 6, 9);
    ctx.lineTo(lineX, 16);
    ctx.lineTo(lineX - 6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}
