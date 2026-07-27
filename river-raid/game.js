// Global variables
let scroll = 0;              // Tracks river scroll position
let scrollSpeed = 2;         // Speed of river scrolling
let planeX;                  // Plane's x-position
let planeY;                  // Plane's y-position (fixed on screen)
let planeSpeed = 5;          // Plane movement speed
let missiles = [];           // Array to store missiles
let targets = [];            // Array to store targets
let fuel = 100;              // Fuel level (0 to 100)
let fuelDecreaseRate = 0.01; // Rate at which fuel decreases per frame
let score = 0;               // Player's score
let lastShot = 0;            // Frame of last shot for cooldown
let shotInterval = 10;       // Frames between shots

// Points assigned to each target type
const pointsForType = {
  tanker: 10,
  helicopter: 20,
  fuelDepot: 0,  // No points to encourage refueling
  bridge: 50
};

// Colors for each target type
const colorsForType = {
  tanker: 'red',
  helicopter: 'yellow',
  fuelDepot: 'green',
  bridge: 'brown'
};

// Setup function to initialize the canvas and plane position
function setup() {
  createCanvas(400, 600);    // Create a 400x600 pixel canvas
  planeX = width / 2;        // Start plane at horizontal center
  planeY = height - 50;      // Position plane near bottom of screen
}

// Main draw loop
function draw() {
  background(0, 0, 255);     // Blue background for water

  // **Draw the riverbanks (land)**
  fill(0, 255, 0);          // Green for land
  // Left bank
  beginShape();
  vertex(0, 0);
  for (let y = 0; y <= height; y++) {
    let riverY = y + scroll;
    let leftX = calculateLeftX(riverY);
    vertex(leftX, y);
  }
  vertex(0, height);
  endShape(CLOSE);
  // Right bank
  beginShape();
  vertex(width, 0);
  for (let y = 0; y <= height; y++) {
    let riverY = y + scroll;
    let rightX = calculateRightX(riverY);
    vertex(rightX, y);
  }
  vertex(width, height);
  endShape(CLOSE);

  // Update scroll position
  scroll -= scrollSpeed;

  // **Draw and move the plane**
  fill(255);                 // White color for plane
  triangle(
    planeX - 10, planeY + 10, // Bottom left
    planeX + 10, planeY + 10, // Bottom right
    planeX, planeY - 10       // Top
  );
  if (keyIsDown(LEFT_ARROW)) {
    planeX -= planeSpeed;
  }
  if (keyIsDown(RIGHT_ARROW)) {
    planeX += planeSpeed;
  }

  // **Check plane collision with riverbanks**
  let planeRiverY = scroll + planeY;
  let leftXPlane = calculateLeftX(planeRiverY);
  let rightXPlane = calculateRightX(planeRiverY);
  if (planeX < leftXPlane || planeX > rightXPlane) {
    gameOver();
    return;
  }

  // **Update and draw missiles**
  stroke(255);               // White for missiles
  for (let i = missiles.length - 1; i >= 0; i--) {
    let m = missiles[i];
    m.screenY -= 5;          // Missile moves upward
    if (m.screenY < 0) {
      missiles.splice(i, 1); // Remove if off top of screen
    } else {
      line(m.x, m.screenY, m.x, m.screenY - 5); // Draw missile as a line
      // Check collisions with targets
      for (let j = targets.length - 1; j >= 0; j--) {
        let t = targets[j];
        if (Math.abs(m.screenY - t.screenY) < 10 && Math.abs(m.x - t.x) < 10) {
          score += pointsForType[t.type];
          missiles.splice(i, 1);
          targets.splice(j, 1);
          break;
        }
      }
    }
  }
  noStroke();                // Reset stroke for other drawings

  // **Generate new targets from the top**
  if (random() < 0.01) {     // 1% chance per frame
    let type = random(['tanker', 'helicopter', 'fuelDepot', 'bridge']);
    let screenY = -20;       // Start off-screen at the top
    // Approximate riverY for screenY=-20, using current scroll
    let riverY_approx = scroll;
    let leftX = calculateLeftX(riverY_approx);
    let rightX = calculateRightX(riverY_approx);
    let x = random(leftX + 10, rightX - 10); // Within river
    let speed = (type === 'tanker' || type === 'helicopter') ? random(-2, 2) : 0;
    targets.push({ type, screenY, x, speed });
  }

  // **Update and draw targets**
  for (let i = targets.length - 1; i >= 0; i--) {
    let t = targets[i];
    t.screenY += scrollSpeed; // Move downwards with the scroll
    if (t.speed) {
      t.x += t.speed;
      // Keep within river at current screenY, approximate riverY
      let riverY_approx = scroll + t.screenY;
      let leftX = calculateLeftX(riverY_approx);
      let rightX = calculateRightX(riverY_approx);
      t.x = constrain(t.x, leftX + 10, rightX - 10);
    }
    if (t.screenY > height) {
      targets.splice(i, 1);  // Remove if off bottom
    } else {
      fill(colorsForType[t.type]);
      rect(t.x - 10, t.screenY - 10, 20, 20); // Draw target as 20x20 square
      // Check for refueling with fuel depots
      if (t.type === 'fuelDepot' && Math.abs(t.screenY - planeY) < 10 && Math.abs(t.x - planeX) < 10) {
        fuel = Math.min(100, fuel + 50);
      }
    }
  }

  // **Handle shooting**
  if (keyIsDown(32) && frameCount - lastShot > shotInterval) { // Space bar
    missiles.push({ x: planeX, screenY: planeY });
    lastShot = frameCount;
  }

  // **Update and check fuel**
  fuel -= fuelDecreaseRate;
  if (fuel <= 0) {
    gameOver();
    return;
  }

  // **Draw HUD (fuel gauge and score)**
  fill(255, 0, 0);          // Red for fuel gauge
  rect(10, 10, fuel * 2, 20); // Width scales with fuel (0-200px)
  fill(0);                 // White for text
  textAlign(LEFT);
  textSize(16);
  text("Fuel: " + fuel, 10, 25)
  text("Score: " + score, 10, 45);
}

// **River generation functions**
function calculateRiverCenter(riverY) {
  return width / 2 + (noise(riverY / 100) - 0.5) * width * 0.5; // Varies around center
}

function calculateRiverWidth(riverY) {
  return 100 + noise((riverY / 100) + 1000) * 200; // Width between 100 and 300
}

function calculateLeftX(riverY) {
  let center = calculateRiverCenter(riverY);
  let widthRiver = calculateRiverWidth(riverY);
  return center - widthRiver / 2;
}

function calculateRightX(riverY) {
  let center = calculateRiverCenter(riverY);
  let widthRiver = calculateRiverWidth(riverY);
  return center + widthRiver / 2;
}

// **Game over function**
function gameOver() {
  noLoop();                  // Stop the draw loop
  textAlign(CENTER);
  textSize(32);
  fill(255, 0, 0);          // Red text
  text("Game Over", width / 2, height / 2);
}
