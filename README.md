Team Name: duaLITy
Team Members: Shreeya Ashtaputre and Ananya Kulkarni
USNs: 2GI24CS149 and 2GI24CS
Project Name:GridPulse
# SmartEnergy 

SmartEnergy is an interactive web application that helps users understand **when electricity is cleaner or more carbon-intensive** and encourages them to run household appliances during cleaner periods.

The application combines real-time electricity-grid carbon-intensity data with an interactive appliance dashboard and visual energy-flow animations.

##  Features

* **Live grid carbon intensity**

  * Retrieves current carbon-intensity data from Electricity Maps.
  * Displays the grid's carbon intensity in `gCO₂/kWh`.
  * Refreshes live data periodically.

* **24-hour carbon-intensity analysis**

  * Fetches historical grid data.
  * Converts the data into a 24-hour carbon-intensity curve.
  * Identifies cleaner and more carbon-intensive periods.

* **Smart appliance scheduling**

  * Interactive appliances such as:

    * Washing machine
    * EV charger
    * Dishwasher
  * Shows when an appliance should ideally be operated based on grid conditions.
  * Calculates estimated CO₂ savings from shifting appliance usage.

* **Interactive grid visualization**

  * Animated renewable and non-renewable energy sources.
  * Visual energy-flow paths.
  * Grid state changes depending on carbon intensity.

* **City / zone selection**

  * Supports selecting a city and its corresponding Electricity Maps zone.
  * The application can display the selected zone throughout the dashboard.

* **Persistent session state**

  * Uses browser `sessionStorage` to preserve:

    * Selected city
    * Selected grid zone
    * Current simulation hour
    * Playback speed
    * Appliance state
    * CO₂ savings

* **Playback controls**

  * Play/pause the simulation.
  * Change simulation speed.
  * Visual animations respond to the current grid conditions.

* **Responsive UI**

  * Designed for desktop and smaller screens.
  * Uses a dark energy-dashboard interface.

## 🛠️ Tech Stack

### Frontend

* HTML5
* CSS3
* Vanilla JavaScript
* SVG animations
* Browser `sessionStorage`

### Backend

* Netlify Serverless Functions
* JavaScript
* Electricity Maps API

### External API

The application uses **Electricity Maps** to retrieve carbon-intensity information for electricity-grid zones.

##  Project Structure

```text
SmartEnergy/
│
├── index.html              # Main appliance dashboard
├── analysis.html           # Carbon-intensity analysis page
├── grid-pulse.html         # Grid Pulse landing/visualization page
├── script.js               # Main application logic
├── style.css               # Application styling and animations
│
└── api/
    └── grid.js             # Netlify serverless API proxy
```

##  API Key Security

The Electricity Maps API key is **not stored in the frontend**.

The frontend requests:

```text
/api/grid
```

The Netlify serverless function then accesses the secret using:

```javascript
process.env.ELECTRICITY_MAPS_API_KEY
```

This keeps the API key on the server side instead of exposing it in browser JavaScript.

### API Function

`api/grid.js` supports:

```text
/api/grid?type=latest&zone=IN-KA
```

and:

```text
/api/grid?type=history&zone=IN-KA
```

The serverless function forwards the request to Electricity Maps using the protected API token.

##  Running Locally

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd SmartEnergy
```

### 2. Configure the API key

For Netlify, add the following environment variable:

```text
ELECTRICITY_MAPS_API_KEY=your_api_key_here
```

Do **not** put the real API key inside:

```text
script.js
index.html
analysis.html
grid-pulse.html
```

and do not commit it to GitHub.

### 3. Run with Netlify

Because the project uses a Netlify serverless function, it should be tested through Netlify's local development environment rather than opening `index.html` directly.

If Netlify CLI is installed:

```bash
netlify dev
```

The application will then be available through the local Netlify development URL.

##  Deploying to Netlify

1. Push the project to GitHub.
2. Log in to Netlify.
3. Create a new site from the GitHub repository.
4. Select the repository containing `SmartEnergy`.
5. Configure the environment variable:

```text
ELECTRICITY_MAPS_API_KEY
```

6. Deploy the site.

After deployment, Netlify will serve the frontend and the `/api/grid` function.

##  Data Flow

The application's data flow is:

```text
User
  │
  ▼
SmartEnergy Frontend
(index.html / script.js)
  │
  │ /api/grid
  ▼
Netlify Serverless Function
(api/grid.js)
  │
  │ API request + secret token
  ▼
Electricity Maps API
  │
  ▼
Carbon Intensity Data
  │
  ▼
SmartEnergy Dashboard
```

The API key therefore remains inside the server-side environment.

## Grid Zones

The application maps supported cities to Electricity Maps zones.

For example, the application can use zones such as:

```text
IN-KA
IN-SO
```

The selected zone is sent to the backend when requesting live or historical carbon-intensity data.

##  Carbon-Intensity States

The application categorizes grid conditions approximately as:

|   Carbon Intensity | Grid State |
| -----------------: | ---------- |
|   `< 150 gCO₂/kWh` | Clean      |
| `150–349 gCO₂/kWh` | Moderate   |
|   `≥ 350 gCO₂/kWh` | Dirty      |

These states affect the dashboard's animations and appliance recommendations.

##  Session Storage

SmartEnergy stores temporary application state in the browser using `sessionStorage`.

Stored information includes:

* Hourly carbon-intensity data
* Live/simulation mode
* Current simulation hour
* Playback state
* Playback speed
* Selected city
* Selected grid zone
* Coordinates
* Triggered appliances
* Estimated CO₂ savings

This allows the dashboard to maintain its state during the current browser session.

##  Purpose

SmartEnergy is designed to demonstrate how **electricity consumption can be shifted toward periods when the electricity grid has lower carbon intensity**.

Instead of only asking:

> "How much electricity am I using?"

the application encourages users to consider:

> "When should I use electricity to reduce my environmental impact?"

##  Security Notes

Never commit secrets to GitHub.

Do not add:

```text
ELECTRICITY_MAPS_API_KEY=actual-secret
```

to source files.

For production deployments, configure the key through the hosting provider's environment-variable settings.

If the API key has ever been accidentally exposed publicly, revoke or rotate it through the Electricity Maps account.

##  Current Status

SmartEnergy is a frontend-focused interactive dashboard with a Netlify serverless API layer for securely retrieving Electricity Maps data.

The project can be deployed as a static frontend with the `api/grid.js` serverless function running through Netlify.

##  License

Add your preferred license here, for example:

```text
MIT License
```

or replace this section with the license chosen for the project.
