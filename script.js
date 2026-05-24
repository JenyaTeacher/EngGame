document.addEventListener("DOMContentLoaded", () => {
    // ── Constants ──────
    const healthTarget = 100;
    const PORTRAIT_ROUND_1_SRC = "boss1.png";
    const PORTRAIT_ROUND_2_SRC = "boss2.png";
    const PORTRAIT_HEALTH_ZERO_SRC = "portrait-health-zero.jpg";

    const healthStart = 1;
    const healthDelayMs = 400;
    const healthDurationMs = 2000;
    const healthRecoveryDurationMs = Math.round(healthDurationMs * 1.45);
    const healthZeroHoldMs = 400;

    const WORD_SPAWN_MS = 1100;
    const WORD_MIN_SPEED = 70;
    const WORD_MAX_SPEED = 125;
    const WORD_HIT_DAMAGE = 7;

    const GRACE_PERIOD_MS = 4000;
    const WORD_START_DELAY_MS = 2000;

    // ── DOM refs ─────────────────────────────────────────────────────────────
    const restartBtn    = document.getElementById("restart-load-btn");
    const moveLeftBtn   = document.getElementById("move-left-btn");
    const moveRightBtn  = document.getElementById("move-right-btn");
    const playerObject  = document.getElementById("player-object");
    const healthBar     = document.getElementById("health-bar");
    const healthPctEl   = document.getElementById("health-pct");
    const portraitImg   = document.getElementById("portrait-img");
    const themeLabel    = document.getElementById("theme-label");
    const wordsLane     = document.getElementById("words-lane");
    const stopwatchDisplay = document.getElementById("stopwatch-display");
    const victoryOverlay   = document.getElementById("victory-overlay");
    const victoryTimeValue = document.getElementById("victory-time-value");
    const victoryRestartBtn = document.getElementById("victory-restart-btn");

    // ── Theme data ────────────────────────────────────────────────────────────
    const themes = ["Vehicles", "Sports", "Electronics", "Foods", "Animals"];
    const wordsByTheme = {
        Vehicles:    ["Car", "Truck", "Bus", "Bike", "Train", "Boat", "Taxi", "Plane"],
        Sports:      ["Goal", "Ball", "Match", "Team", "Coach", "Sprint", "Score", "League"],
        Electronics: ["Phone", "Laptop", "Screen", "Battery", "Sensor", "Chip", "Router", "Camera"],
        Foods:       ["Pizza", "Apple", "Bread", "Soup", "Salad", "Pasta", "Cheese", "Berry"],
        Animals:     ["Tiger", "Wolf", "Eagle", "Shark", "Horse", "Panda", "Fox", "Otter"]
    };
    const distractorWordsByTheme = {
        Vehicles:    ["Pizza", "Tiger", "Laptop", "Goal", "Bread"],
        Sports:      ["Truck", "Battery", "Soup", "Eagle", "Router"],
        Electronics: ["Boat", "Pasta", "Horse", "Score", "Salad"],
        Foods:       ["Taxi", "Sensor", "Wolf", "League", "Train"],
        Animals:     ["Phone", "Cheese", "Match", "Bus", "Camera"]
    };

    let currentRound = 1;
    let currentPortraitHealthySrc = PORTRAIT_ROUND_1_SRC;
    let currentThemeIndex = 0;
    let activeThemeWords = ["Word"];
    let activeDistractorWords = ["Other"];
    let allowBossRevival = true;

    function applyThemeByIndex(index) {
        const normalized = ((index % themes.length) + themes.length) % themes.length;
        currentThemeIndex = normalized;
        const theme = themes[currentThemeIndex];
        activeThemeWords = wordsByTheme[theme] ?? ["Word"];
        activeDistractorWords = distractorWordsByTheme[theme] ?? ["Other"];
        if (themeLabel) themeLabel.textContent = "THEME: " + theme.toUpperCase();
    }

    // ── State ─────────────────────────────────────────────────────────────────
    let currentHealthPct     = healthTarget;
    let portraitLockedToZero = false;
    let roundTransitioning   = false;
    let invincibleUntil      = 0;
    let sessionVictory       = false;

    let moveDirection  = 0;
    let moveRafId      = null;
    let playerOffsetX  = 0;
    const moveSpeedPxPerSec = 190;
    let moveLimitPx = 340;

    function updateMoveLimitFromLayout() {
        const boundsEl = wordsLane || playerObject?.closest(".ui-wrapper") || playerObject?.closest(".section.bottom");
        const boundsW = boundsEl && boundsEl.clientWidth > 0 ? boundsEl.clientWidth : Math.floor(window.innerWidth);
        const playerW = playerObject ? playerObject.offsetWidth : 72;
        const margin = 2;
        moveLimitPx = Math.round(Math.max(80, (boundsW - playerW) / 2 - margin));
    }

    window.addEventListener("resize", () => {
        updateMoveLimitFromLayout();
        setPlayerOffset(playerOffsetX);
    });

    let healthAnimRafId         = null;
    let healthRecoveryTimeoutId = null;

    const fallingWords      = [];
    let wordSpawnIntervalId = null;
    let wordsRafId          = null;
    let wordsPrevTs         = null;
    let wordStartTimeoutId  = null;

    let stopwatchSessionStart = null;
    let stopwatchRafId        = null;

    function formatStopwatchMs(ms) {
        const clamped = Math.max(0, ms);
        const t = Math.floor(clamped / 100);
        const tenth = t % 10;
        const sec = Math.floor(t / 10) % 60;
        const min = Math.floor(t / 600);
        return String(min).padStart(2, "0") + ":" + String(sec).padStart(2, "0") + "." + tenth;
    }

    function stopStopwatch() {
        if (stopwatchRafId !== null) { cancelAnimationFrame(stopwatchRafId); stopwatchRafId = null; }
    }

    function tickStopwatch(now) {
        if (!stopwatchDisplay || stopwatchSessionStart === null) return;
        stopwatchDisplay.textContent = formatStopwatchMs(now - stopwatchSessionStart);
        stopwatchRafId = requestAnimationFrame(tickStopwatch);
    }

    function startStopwatch() {
        stopStopwatch();
        stopwatchSessionStart = performance.now();
        if (stopwatchDisplay) stopwatchDisplay.textContent = formatStopwatchMs(0);
        stopwatchRafId = requestAnimationFrame(tickStopwatch);
    }

    function hideVictory() {
        if (victoryOverlay) victoryOverlay.hidden = true;
    }

    function enterVictoryState() {
        if (sessionVictory) return;
        sessionVictory = true;
        roundTransitioning = false;
        stopStopwatch();
        if (wordStartTimeoutId !== null) { clearTimeout(wordStartTimeoutId); wordStartTimeoutId = null; }
        stopWordGeneration();
        clearWords();
        cancelHealthAnim();
        cancelHealthRecoveryDelay();
        moveDirection = 0;
        if (moveRafId !== null) { cancelAnimationFrame(moveRafId); moveRafId = null; }
        if (victoryTimeValue && stopwatchDisplay) victoryTimeValue.textContent = stopwatchDisplay.textContent;
        if (victoryOverlay) victoryOverlay.hidden = false;
    }

    // ── Health ────────────────────────────────────────────────────────────────
    function applyHealthDisplay(pct) {
        currentHealthPct = Math.min(healthTarget, Math.max(0, Math.round(pct)));
        healthBar.style.width = currentHealthPct + "%";
        healthPctEl.textContent = currentHealthPct + "%";
        if (portraitImg) {
            if (currentHealthPct <= 0) portraitLockedToZero = true;
            portraitImg.src = portraitLockedToZero ? PORTRAIT_HEALTH_ZERO_SRC : currentPortraitHealthySrc;
        }
    }

    function cancelHealthAnim() {
        if (healthAnimRafId !== null) { cancelAnimationFrame(healthAnimRafId); healthAnimRafId = null; }
    }

    function cancelHealthRecoveryDelay() {
        if (healthRecoveryTimeoutId !== null) { clearTimeout(healthRecoveryTimeoutId); healthRecoveryTimeoutId = null; }
    }

    function runHealthRamp(fromPct, toPct, durationMs, onComplete) {
        cancelHealthAnim();
        const span = toPct - fromPct;
        if (durationMs <= 0 || span === 0) { applyHealthDisplay(toPct); if (onComplete) onComplete(); return; }
        const t0 = performance.now();
        function tick(now) {
            const t = Math.min(1, (now - t0) / durationMs);
            const eased = 1 - (1 - t) * (1 - t);
            applyHealthDisplay(Math.min(healthTarget, Math.max(0, Math.round(fromPct + eased * span))));
            if (t < 1) { healthAnimRafId = requestAnimationFrame(tick); }
            else        { healthAnimRafId = null; if (onComplete) onComplete(); }
        }
        healthAnimRafId = requestAnimationFrame(tick);
    }

    // ── Round transition ──────────────────────────────────────────────────────
    function startNextRoundAfterBossDefeat() {
        allowBossRevival = false;
        applyThemeByIndex(currentThemeIndex + 1);
        currentRound += 1;
        currentPortraitHealthySrc = currentRound >= 2 ? PORTRAIT_ROUND_2_SRC : PORTRAIT_ROUND_1_SRC;
        stopWordGeneration();
        clearWords();
        portraitLockedToZero = false;
        invincibleUntil = performance.now() + GRACE_PERIOD_MS;
        runHealthRamp(0, healthTarget, healthRecoveryDurationMs, () => {
            roundTransitioning = false;
            scheduleWordStart(WORD_START_DELAY_MS);
        });
    }

    // ── Visual Feedback ───────────────────────────────────────────────────────
    function showScreenFlash(color) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.backgroundColor = color;
        overlay.style.zIndex = '999';
        overlay.style.pointerEvents = 'none';
        overlay.style.transition = 'opacity 0.3s ease-out';
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
            });
        });
    }

    // ── Damage & Penalties ────────────────────────────────────────────────────
    function applyWordHitDamage() {
        if (sessionVictory || roundTransitioning || performance.now() < invincibleUntil) return;
        const next = Math.max(0, currentHealthPct - WORD_HIT_DAMAGE);
        if (next <= 0) roundTransitioning = true;
        applyHealthDisplay(next);
        
        if (next === 0) {
            cancelHealthAnim();
            cancelHealthRecoveryDelay();
            if (allowBossRevival) {
                healthRecoveryTimeoutId = setTimeout(() => {
                    healthRecoveryTimeoutId = null;
                    startNextRoundAfterBossDefeat();
                }, healthZeroHoldMs);
            } else {
                enterVictoryState();
            }
        }
    }

    function healBossPenalty() {
        if (sessionVictory || roundTransitioning || performance.now() < invincibleUntil) return;
        // Відновлюємо здоров'я боса як штраф
        const next = Math.min(100, currentHealthPct + WORD_HIT_DAMAGE);
        applyHealthDisplay(next);
    }

    // ── Words ─────────────────────────────────────────────────────────────────
    function spawnWordObject() {
        if (sessionVictory || !wordsLane) return;
        const laneWidth = wordsLane.clientWidth;
        if (laneWidth <= 0) return;
        
        const spawnCorrect = Math.random() < 0.7;
        const source = spawnCorrect ? activeThemeWords : activeDistractorWords;
        const word = source[Math.floor(Math.random() * source.length)];
        
        const el = document.createElement("span");
        el.className = "word-object";
        el.textContent = word;
        wordsLane.appendChild(el);
        
        const elWidth = el.offsetWidth || 40;
        const x = Math.random() * Math.max(0, laneWidth - elWidth);
        el.style.left = "0px";
        el.style.top  = "0px";
        
       fallingWords.push({
            el, isCorrect: spawnCorrect, x, y: -80, // Змінено: слова спавняться значно вище
            speed: WORD_MIN_SPEED + Math.random() * (WORD_MAX_SPEED - WORD_MIN_SPEED)
        });
    }

    function intersectsRect(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    function tickWords(ts) {
        if (sessionVictory || !wordsLane) return;
        if (wordsPrevTs === null) wordsPrevTs = ts;
        const dt = Math.min(0.05, (ts - wordsPrevTs) / 1000);
        wordsPrevTs = ts;
        
        const laneHeight = wordsLane.clientHeight;
        const playerRect = playerObject ? playerObject.getBoundingClientRect() : null;
        
        for (let i = fallingWords.length - 1; i >= 0; i--) {
            const item = fallingWords[i];
            item.y += item.speed * dt;
            item.el.style.transform = "translate(" + item.x + "px, " + item.y + "px)";
            
            const wordRect = item.el.getBoundingClientRect();
            
            if (playerRect && intersectsRect(wordRect, playerRect)) {
                item.el.remove();
                fallingWords.splice(i, 1);
                
                // Перевірка на правильне слово та застосування механік
                if (item.isCorrect) {
                    applyWordHitDamage(); // Шкода босу
                    showScreenFlash('rgba(57, 255, 20, 0.15)'); // Зелений спалах (успіх)
                } else {
                    healBossPenalty(); // Штраф (лікування боса)
                    showScreenFlash('rgba(255, 0, 60, 0.15)'); // Червоний спалах (помилка)
                }
                continue;
            }
            if (item.y > laneHeight + 56) { item.el.remove(); fallingWords.splice(i, 1); }
        }
        wordsRafId = requestAnimationFrame(tickWords);
    }

    function startWordGeneration() {
        if (sessionVictory || !wordsLane) return;
        if (wordSpawnIntervalId !== null) clearInterval(wordSpawnIntervalId);
        wordSpawnIntervalId = setInterval(spawnWordObject, WORD_SPAWN_MS);
        if (wordsRafId === null) { wordsPrevTs = null; wordsRafId = requestAnimationFrame(tickWords); }
        for (let i = 0; i < 4; i++) setTimeout(spawnWordObject, i * 220);
    }

    function stopWordGeneration() {
        if (wordSpawnIntervalId !== null) { clearInterval(wordSpawnIntervalId); wordSpawnIntervalId = null; }
        if (wordsRafId !== null)          { cancelAnimationFrame(wordsRafId);   wordsRafId = null; }
    }

    function clearWords() {
        while (fallingWords.length > 0) fallingWords.pop().el.remove();
    }

    function scheduleWordStart(delayMs) {
        if (wordStartTimeoutId !== null) clearTimeout(wordStartTimeoutId);
        wordStartTimeoutId = setTimeout(() => {
            wordStartTimeoutId = null;
            startWordGeneration();
        }, delayMs);
    }

    // ── Movement ──────────────────────────────────────────────────────────────
    function setPlayerOffset(x) {
        playerOffsetX = Math.max(-moveLimitPx, Math.min(moveLimitPx, x));
        if (playerObject) playerObject.style.transform = "translateX(" + playerOffsetX + "px)";
    }

    function stopMoving() { moveDirection = 0; }

    function startMoving(direction) {
        if (sessionVictory) return;
        moveDirection = direction;
        if (moveRafId === null) {
            let prev = performance.now();
            const step = (now) => {
                const dt = (now - prev) / 1000;
                prev = now;
                if (moveDirection !== 0) setPlayerOffset(playerOffsetX + moveDirection * moveSpeedPxPerSec * dt);
                if (moveDirection !== 0) { moveRafId = requestAnimationFrame(step); }
                else                     { moveRafId = null; }
            };
            moveRafId = requestAnimationFrame(step);
        }
    }

    function bindHoldToMove(button, direction) {
        if (!button) return;
        button.addEventListener("pointerdown", (e) => { e.preventDefault(); button.setPointerCapture && button.setPointerCapture(e.pointerId); startMoving(direction); });
        button.addEventListener("pointerup",          stopMoving);
        button.addEventListener("pointercancel",      stopMoving);
        button.addEventListener("pointerleave",       stopMoving);
        button.addEventListener("lostpointercapture", stopMoving);
    }

    bindHoldToMove(moveLeftBtn,  -1);
    bindHoldToMove(moveRightBtn,  1);

    // ── Start / Restart ───────────────────────────────────────────────────────
    function restartSession() {
        sessionVictory = false;
        hideVictory();
        stopStopwatch();
        if (moveRafId !== null)        { cancelAnimationFrame(moveRafId);  moveRafId  = null; }
        if (wordStartTimeoutId !== null) { clearTimeout(wordStartTimeoutId); wordStartTimeoutId = null; }
        stopWordGeneration();
        clearWords();
        cancelHealthAnim();
        cancelHealthRecoveryDelay();

        roundTransitioning = false;
        moveDirection      = 0;

        allowBossRevival = true;
        currentRound = 1;
        currentPortraitHealthySrc = PORTRAIT_ROUND_1_SRC;
        applyThemeByIndex(Math.floor(Math.random() * themes.length));
        portraitLockedToZero = false;
        applyHealthDisplay(healthTarget);

        playerOffsetX = 0;
        if (playerObject) playerObject.style.transform = "translateX(0px)";

        invincibleUntil = performance.now() + GRACE_PERIOD_MS;

        startStopwatch();
        scheduleWordStart(WORD_START_DELAY_MS);
        requestAnimationFrame(() => {
            updateMoveLimitFromLayout();
            setPlayerOffset(playerOffsetX);
        });
    }

    restartBtn.addEventListener("click", restartSession);
    if (victoryRestartBtn) victoryRestartBtn.addEventListener("click", restartSession);

    // ── Boot ──────────────────────────────────────────────────────────────────
    restartSession();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            updateMoveLimitFromLayout();
            setPlayerOffset(playerOffsetX);
        });
    });
    setTimeout(() => { runHealthRamp(healthStart, healthTarget, healthDurationMs); }, healthDelayMs);
});
