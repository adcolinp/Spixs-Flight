GAME DESIGN DOCUMENT: Caraíba’s Path (Working Title)
1. Executive Summary
Genre: Atmospheric Roguelite / Survival Horror.
Platform: PC (Web/Phaser.js) with future Steam potential (Electron).
Core Loop: Fly → Explore Fog → Anchor Spirits in Caraíba Trees → Avoid Human Threats/Reaper → Reach the Sanctuary.
The Message: An interactive chronicle of the Spix’s Macaw’s decline, emphasizing that human intervention silences the soul of the jungle.

2. Narrative & World-Building
The Protagonist: An Ancient Protector Spirit of the Caatinga (Aratuba/The Weaver).
The Mission: Mark a safe "Spirit Path" for the last living Macaws to reach a hidden Sanctuary.
The Clock: The game starts in 1987. Each failure jumps the clock significantly toward 2000 (Extinction).
The End State: Reaching the year 2000 triggers the "Final Flight," revealing the spirit's work as a foundation for the real-world 2021 reintroduction.

3. Mechanics & "Game Feel"

3.1. Movement (The "Weight of Flight")
Inertia: The bird has a turning radius and momentum; it cannot stop on a dime.
The Spirit Dash: A burst of speed that allows "phasing" through traps.
Stamina System: * Cost: Dashing consumes a significant portion of the Energy bar.
Recovery: Energy only refills while actively "Anchoring" at a Caraíba tree. Refill is time-based (e.g., 20% per second).

3.2. The Anchor System (The Ritual)
To "save" a tree, the player must stay within its radius for 5 seconds.
The Pulse: Once anchored, the tree turns Cyan and sends a small ripple through the fog.

3.3. Procedural Generation & Environment
The River: A visual guide. Caraíba trees cluster near the river, creating a natural "path" through the map.
Deforestation Zones: High-risk, greyed-out shortcuts with increased trap density and "Spirit Erosion" (passive health drain).

4. The Antagonists (The Silence)
4.1 Enemy: The Trap
Behaviour: Static, hidden in fog. Lethal on contact.
Visual/Audio Cue: Metallic glint/X-shape.

4.2 Enemy: The Poacher
Behaviour: Patrols an area; chases if player is detected.
Visual/Audio Cue: Humanoid silhouette; heavy footsteps.

4.3 Enemy: The Reaper
Behaviour: Inevitable, slow-moving ghost Macaw/Human
Visual/Audio Cue: The Silence: All ambient music/birdsong cuts to 0%. Trees shake as it passes.

5. Technical Specifications
Engine: Phaser.js (JavaScript).
Art Style: Low-res Pixel Art or Hand-Painted 2D.
UI/HUD: Fixed to camera. Includes the "Extinction Clock" (Year) and "Spirit Sense" (flickering when threats are near).
Persistence: LocalStorage saves:Current Year.Spirit Essence (Currency).Unlocked Ancestral Boons.

6. Audio Design (The "Heartbeat")
Dynamic Layers: Lush jungle sounds in safe zones; industrial construction/chainsaw noises in Deforested Zones.
Feedback: Wind gusts and rustling leaves for successful actions; a sharp "snare" sound for collisions.

7. Meta-Progression (The Spirit Realm)
Between runs, the player returns to The Great Caraíba (The Hub).
Upgrades: Spend "Spirit Essence" to buy:
Keen Eye: Larger visibility radius.
Hollow Bones: Reduced Dash energy cost.
Ancestral Call (E key): Temporary "Sonar" to find trees through fog.