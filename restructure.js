const fs = require('fs');
const path = require('path');

// Read the full original index.html
const html = fs.readFileSync('index.html', 'utf8');
const lines = html.split('\n');

// === SECTION BOUNDARIES (0-indexed) ===
// Lines 1-154 (idx 0-153): Head section
// Lines 155-235 (idx 154-234): Screen 1 Landing
// Lines 236-237 (idx 235-236): blank
// Lines 238-737 (idx 237-736): Screens 2-6 HTML
// Lines 738-742 (idx 737-741): blank/comments
// Lines 743-1639 (idx 742-1638): All script blocks
// Lines 1640-1642 (idx 1639-1641): </body></html>

// --- Extract Screens 2-6 HTML ---
const screensHTML = lines.slice(237, 737).join('\n');

// --- Extract ALL JavaScript from script blocks ---
// We need the inner content of each script block, concatenated.
// Script blocks: 745-755, 758-862, 865-1036, 1039-1592, 1595-1633, 1635-1639
const scriptRanges = [
  [744, 754],   // Vturb loader (lines 745-755, inner: 746-754)
  [757, 861],   // Sound engine (lines 758-862, inner: 759-861)
  [864, 1035],  // SVG assets + DOMContentLoaded init (lines 865-1036, inner: 866-1035)
  [1038, 1591], // Navigation, Timer, Game, Registration, VSL logic (lines 1039-1592, inner: 1040-1591)
  [1594, 1632], // Confetti (lines 1595-1633, inner: 1596-1632)
  [1634, 1638], // Context menu block (lines 1635-1639, inner: 1636-1638)
];

let allScripts = '';
for (const [startIdx, endIdx] of scriptRanges) {
  // Extract inner content (skip the <script> and </script> lines)
  const innerLines = lines.slice(startIdx + 1, endIdx);
  allScripts += innerLines.join('\n') + '\n\n';
}

// --- Modify the scripts ---
// 1. Replace the first DOMContentLoaded (SVG injection) to run immediately
allScripts = allScripts.replace(
  `    // Inject SVGs into containers on load
    document.addEventListener("DOMContentLoaded", () => {`,
  `    // Inject SVGs into containers (runs immediately after dynamic load)
    (function initSVGs() {`
);

// Close the IIFE properly - the original ends with });
// Find and replace the specific closing of this DOMContentLoaded
// It's followed by the comment "<!-- Navigation, Timer, Form, & Game logic -->"
// The original block ends at line 1035: "    });"
// We need to replace the first occurrence of "    });" after "initSVGs"
// Actually, let's be more targeted. The original has:
//   startLandingClock();
//
//
//     });
// We replace it with:
//   startLandingClock();
//
//
//     })();

allScripts = allScripts.replace(
  `      // Start countdown clock
      startLandingClock();


    });`,
  `      // Start countdown clock
      startLandingClock();


    })();`
);

// 2. Replace the second DOMContentLoaded (button listeners) to run immediately  
allScripts = allScripts.replace(
  `    // Attach listeners on DOM ready
    document.addEventListener("DOMContentLoaded", () => {
      const btnParticipar = document.querySelector(".btn-participar");
      if (btnParticipar) {
        btnParticipar.onclick = () => switchScreen('welcome');
      }
      const btnWelcomeClose = document.querySelector(".btn-welcome-close");
      if (btnWelcomeClose) {
        btnWelcomeClose.onclick = () => switchScreen('landing');
      }
      const btnWelcomeStart = document.querySelector(".btn-welcome-start");
      if (btnWelcomeStart) {
        btnWelcomeStart.onclick = () => switchScreen('playing');
      }
    });`,
  `    // Attach listeners immediately (dynamic load - DOM already ready)
    (function initListeners() {
      const btnParticipar = document.querySelector(".btn-participar");
      if (btnParticipar) {
        btnParticipar.onclick = () => switchScreen('welcome');
      }
      const btnWelcomeClose = document.querySelector(".btn-welcome-close");
      if (btnWelcomeClose) {
        btnWelcomeClose.onclick = () => switchScreen('landing');
      }
      const btnWelcomeStart = document.querySelector(".btn-welcome-start");
      if (btnWelcomeStart) {
        btnWelcomeStart.onclick = () => switchScreen('playing');
      }
    })();`
);

// --- Build the new index.html ---
const headAndLanding = lines.slice(0, 235).join('\n');

const newIndexHTML = `${headAndLanding}

  <!-- Dynamic content container (loaded via API) -->
  <div id="dynamic-content"></div>

  <script>
    // Bootstrap: Load remaining screens and game logic from serverless API
    (function() {
      var loaded = false;

      function bootstrap() {
        if (loaded) return;
        loaded = true;

        fetch('/api/stages')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            // 1. Inject HTML of screens 2-6
            document.getElementById('dynamic-content').innerHTML = data.html;

            // 2. Execute the game scripts
            var scriptEl = document.createElement('script');
            scriptEl.textContent = data.scripts;
            document.body.appendChild(scriptEl);

            console.log('Dynamic content loaded successfully');
          })
          .catch(function(err) {
            console.error('Failed to load dynamic content:', err);
          });
      }

      // Start loading immediately
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
      } else {
        bootstrap();
      }
    })();
  </script>

</body>
</html>`;

// --- Build the Vercel Serverless Function ---
const apiFunction = `module.exports = (req, res) => {
  // Set CORS and caching headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

  const html = ${JSON.stringify(screensHTML)};
  const scripts = ${JSON.stringify(allScripts)};

  res.status(200).json({ html, scripts });
};
`;

// --- Build vercel.json ---
const vercelConfig = JSON.stringify({
  "rewrites": [
    { "source": "/api/stages", "destination": "/api/stages.js" }
  ]
}, null, 2);

// --- Write all files ---

// Backup original
fs.copyFileSync('index.html', 'index_pre_restructure_backup.html');
console.log('✅ Backup saved: index_pre_restructure_backup.html');

// Write new index.html
fs.writeFileSync('index.html', newIndexHTML, 'utf8');
console.log('✅ New index.html written (landing page only + bootstrap)');

// Create api directory and write stages.js
fs.mkdirSync('api', { recursive: true });
fs.writeFileSync(path.join('api', 'stages.js'), apiFunction, 'utf8');
console.log('✅ api/stages.js written (serverless function)');

// Write vercel.json
fs.writeFileSync('vercel.json', vercelConfig, 'utf8');
console.log('✅ vercel.json written');

// --- Validation ---
const newHTML = fs.readFileSync('index.html', 'utf8');
const hasLanding = newHTML.includes('screen-landing');
const hasNoWelcome = !newHTML.includes('screen-welcome');
const hasNoPlaying = !newHTML.includes('screen-playing');
const hasNoSummary = !newHTML.includes('screen-summary');
const hasNoRegistration = !newHTML.includes('screen-registration');
const hasNoVSL = !newHTML.includes('screen-vsl');
const hasBootstrap = newHTML.includes("fetch('/api/stages')");

console.log('');
console.log('=== VALIDATION ===');
console.log('Landing page present:', hasLanding);
console.log('Welcome screen removed:', hasNoWelcome);
console.log('Playing screen removed:', hasNoPlaying);
console.log('Summary screen removed:', hasNoSummary);
console.log('Registration screen removed:', hasNoRegistration);
console.log('VSL screen removed:', hasNoVSL);
console.log('Bootstrap fetch present:', hasBootstrap);

const apiFile = fs.readFileSync(path.join('api', 'stages.js'), 'utf8');
const apiHasWelcome = apiFile.includes('screen-welcome');
const apiHasPlaying = apiFile.includes('screen-playing');
const apiHasGameLogic = apiFile.includes('switchScreen');
const apiHasVSL = apiFile.includes('startVslFlow');

console.log('API has Welcome screen:', apiHasWelcome);
console.log('API has Playing screen:', apiHasPlaying);
console.log('API has game logic:', apiHasGameLogic);
console.log('API has VSL logic:', apiHasVSL);

if (hasLanding && hasNoWelcome && hasNoPlaying && hasNoSummary && hasNoRegistration && hasNoVSL && hasBootstrap && apiHasWelcome && apiHasPlaying && apiHasGameLogic && apiHasVSL) {
  console.log('');
  console.log('🎉 ALL VALIDATIONS PASSED! Restructuring complete.');
} else {
  console.log('');
  console.log('⚠️  Some validations failed. Please review the output.');
}
