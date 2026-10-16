function rgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const vals = [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16));
    return `rgba(${vals.join(',')},${alpha})`;
}
/** Material rendering is skin-data-driven; no puzzle rules depend on presentation. */
export function renderTile(ctx, skin, tile, x, y, primed, held, beat, flash, nearbyGlow = 0) {
    const u = 72, c = skin.palette[tile.type], pulse = primed ? Math.sin(beat * Math.PI * 8) * 1.2 : 0;
    const pad = primed ? 3 + pulse : 3, xx = x + pad, yy = y + pad, w = u - 2 * pad, cx = x + 36, cy = y + 36;
    ctx.save();
    if (primed || nearbyGlow > 0) {
        ctx.shadowBlur = primed ? (held ? 31 : 20) : nearbyGlow * 12;
        ctx.shadowColor = c;
    }
    ctx.fillStyle = rgba(c, primed ? .98 : .8);
    ctx.fillRect(xx, yy, w, w);
    ctx.shadowBlur = 0;
    switch (skin.texture) {
        case 'enamel': {
            const g = ctx.createLinearGradient(xx, yy, xx + w, yy + w);
            g.addColorStop(0, '#ffffff44');
            g.addColorStop(.35, '#ffffff06');
            g.addColorStop(1, '#0707118e');
            ctx.fillStyle = g;
            ctx.fillRect(xx, yy, w, w);
            ctx.fillStyle = '#ffffff22';
            ctx.fillRect(xx + 5, yy + 5, w - 10, 7);
            ctx.strokeStyle = '#121021a0';
            ctx.lineWidth = 2;
            ctx.strokeRect(xx + 5, yy + 5, w - 10, w - 10);
            break;
        }
        case 'glass': {
            ctx.fillStyle = '#ffffff40';
            ctx.beginPath();
            ctx.moveTo(xx, yy);
            ctx.lineTo(xx + w, yy);
            ctx.lineTo(xx + w * .28, yy + w);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#0b102b65';
            ctx.beginPath();
            ctx.moveTo(xx + w, yy);
            ctx.lineTo(xx + w, yy + w);
            ctx.lineTo(xx + w * .25, yy + w);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#ffffffbd';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xx + 8, yy + w - 9);
            ctx.lineTo(xx + w * .61, yy + 8);
            ctx.lineTo(xx + w - 8, yy + 8);
            ctx.stroke();
            break;
        }
        case 'phosphor': {
            ctx.fillStyle = '#080c22d5';
            ctx.fillRect(xx + 4, yy + 4, w - 8, w - 8);
            ctx.fillStyle = rgba(c, .42);
            ctx.fillRect(xx + 7, yy + 7, w - 14, w - 14);
            ctx.fillStyle = '#ffffff13';
            for (let i = 8; i < w - 6; i += 5)
                ctx.fillRect(xx + 5, yy + i, w - 10, 2);
            ctx.strokeStyle = rgba(c, .95);
            ctx.lineWidth = 2;
            ctx.strokeRect(xx + 6, yy + 6, w - 12, w - 12);
            break;
        }
        case 'stone': {
            ctx.fillStyle = '#05041166';
            ctx.fillRect(xx + 5, yy + 7, w - 10, w - 12);
            ctx.fillStyle = rgba(c, .9);
            ctx.fillRect(xx + 7, yy + 6, w - 14, w - 17);
            ctx.strokeStyle = '#ffffff70';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xx + 11, yy + 7);
            ctx.lineTo(xx + 11, yy + w - 11);
            ctx.moveTo(xx + 11, yy + 26);
            ctx.lineTo(xx + w - 9, yy + 26);
            ctx.moveTo(xx + 27, yy + w - 10);
            ctx.lineTo(xx + 27, yy + 26);
            ctx.moveTo(xx + 32, yy + 7);
            ctx.lineTo(xx + 32, yy + 26);
            ctx.stroke();
            break;
        }
        case 'crystal': {
            ctx.fillStyle = '#ffffff5a';
            ctx.beginPath();
            ctx.moveTo(cx, yy + 5);
            ctx.lineTo(xx + w - 6, cy - 9);
            ctx.lineTo(cx, cy + 12);
            ctx.lineTo(xx + 6, cy - 7);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#081a3b65';
            ctx.beginPath();
            ctx.moveTo(cx, cy + 12);
            ctx.lineTo(xx + w - 6, cy - 9);
            ctx.lineTo(cx, yy + w - 5);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#ffffff9b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, yy + 5);
            ctx.lineTo(cx, yy + w - 5);
            ctx.moveTo(xx + 7, cy - 7);
            ctx.lineTo(xx + w - 7, cy - 7);
            ctx.stroke();
            break;
        }
        case 'obsidian': {
            ctx.fillStyle = '#080911dc';
            ctx.fillRect(xx + 4, yy + 4, w - 8, w - 8);
            const grad = ctx.createLinearGradient(xx, yy, xx + w, yy + w);
            grad.addColorStop(0, rgba(c, .75));
            grad.addColorStop(.55, '#06070d10');
            grad.addColorStop(1, rgba(c, .28));
            ctx.fillStyle = grad;
            ctx.fillRect(xx + 5, yy + 5, w - 10, w - 10);
            ctx.strokeStyle = rgba(c, .85);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xx + 12, yy + 8);
            ctx.lineTo(cx - 4, cy - 8);
            ctx.lineTo(cx + 12, cy + 5);
            ctx.lineTo(xx + w - 11, yy + w - 9);
            ctx.stroke();
            break;
        }
    }
    // Colour-vision-safe marks: four unique inner profiles, across all materials.
    ctx.fillStyle = '#060617b0';
    ctx.strokeStyle = '#f9fafbcc';
    ctx.lineWidth = 2;
    if (tile.type === 0) {
        ctx.beginPath();
        ctx.moveTo(cx - 15, cy + 11);
        ctx.lineTo(cx + 12, cy - 16);
        ctx.lineTo(cx + 17, cy - 10);
        ctx.lineTo(cx - 10, cy + 17);
        ctx.stroke();
        ctx.fillRect(cx - 15, cy - 17, 7, 7);
    }
    if (tile.type === 1) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18);
        ctx.lineTo(cx + 17, cy);
        ctx.lineTo(cx, cy + 18);
        ctx.lineTo(cx - 17, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    if (tile.type === 2) {
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
    }
    if (tile.type === 3) {
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 13);
        ctx.lineTo(cx + 16, cy + 13);
        ctx.moveTo(cx + 16, cy - 13);
        ctx.lineTo(cx - 16, cy + 13);
        ctx.stroke();
        ctx.fillRect(cx - 4, cy - 4, 8, 8);
    }
    if (primed) {
        ctx.lineWidth = held ? 3 : 2;
        ctx.strokeStyle = held ? '#fffefb' : '#ffffffd6';
        ctx.strokeRect(xx + 4, yy + 4, w - 8, w - 8);
        ctx.fillStyle = rgba('#ffffff', Math.max(.12, flash * .5));
        ctx.fillRect(xx + 7, yy + 7, w - 14, 3);
        if (held) {
            ctx.beginPath();
            ctx.moveTo(cx, yy + 8);
            ctx.lineTo(xx + w - 8, cy);
            ctx.lineTo(cx, yy + w - 8);
            ctx.lineTo(xx + 8, cy);
            ctx.closePath();
            ctx.stroke();
        }
    }
    if (nearbyGlow > 0 && !primed) {
        ctx.strokeStyle = rgba(c, Math.min(.45, nearbyGlow * .15));
        ctx.strokeRect(xx + 2, yy + 2, w - 4, w - 4);
    }
    ctx.restore();
}
export function renderSweep(ctx, skin, lineX, w, h, intensity, time) {
    if (skin.sweep === 'hidden') { // CODA intentionally removes the visual sweep; musical cues continue.
        return;
    }
    ctx.save();
    const accent = skin.accent;
    if (skin.sweep === 'rain') {
        ctx.strokeStyle = rgba(accent, intensity * .7);
        ctx.lineWidth = 2;
        for (let i = 0; i < 15; i++) {
            const xx = lineX - 45 + (i * 43) % 74, yy = (i * 119 + time * 0.08) % h;
            ctx.beginPath();
            ctx.moveTo(xx, yy);
            ctx.lineTo(xx - 8, yy + 45);
            ctx.stroke();
        }
    }
    else if (skin.sweep === 'scan') {
        ctx.fillStyle = rgba(accent, .10 * intensity);
        ctx.fillRect(lineX - 50, 0, 50, h);
        ctx.setLineDash([9, 12]);
        ctx.lineWidth = 5;
        ctx.strokeStyle = rgba(accent, .75 * intensity);
        ctx.beginPath();
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, h);
        ctx.stroke();
    }
    else if (skin.sweep === 'fracture') {
        ctx.lineWidth = 4;
        ctx.strokeStyle = rgba(accent, .85 * intensity);
        ctx.beginPath();
        ctx.moveTo(lineX, 0);
        for (let y = 0; y <= h; y += 36)
            ctx.lineTo(lineX + (Math.floor(y / 36) % 2 ? 9 : -9), y);
        ctx.stroke();
    }
    else {
        const g = ctx.createLinearGradient(lineX - 65, 0, lineX + 10, 0);
        g.addColorStop(0, rgba(accent, 0));
        g.addColorStop(.78, rgba(accent, .24 * intensity));
        g.addColorStop(1, rgba('#ffffff', .85 * intensity));
        ctx.fillStyle = g;
        ctx.fillRect(lineX - 65, 0, 75, h);
        ctx.strokeStyle = rgba(skin.sweep === 'sunset' ? '#ffceae' : '#ffffff', .9 * intensity);
        ctx.lineWidth = skin.sweep === 'sunset' ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, h);
        ctx.stroke();
    }
    ctx.restore();
}
