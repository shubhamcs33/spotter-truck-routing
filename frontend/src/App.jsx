
import React, { useState, useEffect } from 'react'
import {
  Truck, MapPin, Route, Clock, CloudRain, Wind,
  ShieldCheck, Gauge, Bell, Settings, Search,
  CalendarDays, Navigation, AlertTriangle, Layers,
  ChevronDown, ArrowUpRight, RefreshCw, Activity, Zap
} from 'lucide-react'

import {
  MapContainer, TileLayer, Polyline,
  CircleMarker, Circle, Popup
} from 'react-leaflet'

import 'leaflet/dist/leaflet.css'
import './App.css'

const demoRouteData = [
  {
    id: 'alpha',
    name: 'Northern Express',
    driver: 'Demo Driver A',
    vehicle: 'Heavy Truck A',
    distance: '1,280 mi',
    duration: '19h 20m',
    status: 'Safest',
    color: '#ff922e',
    severe: 0,
    high: 2,
    risk: 'Low',
    coordinates: [
      [39.7392, -104.9903],
      [40.0150, -105.2705],
      [41.1400, -104.8202],
      [41.2565, -95.9345],
      [39.0997, -94.5786]
    ]
  },
  {
    id: 'beta',
    name: 'Central Highway',
    driver: 'Demo Driver B',
    vehicle: 'Heavy Truck B',
    distance: '1,190 mi',
    duration: '18h 10m',
    status: 'Moderate',
    color: '#39d5f5',
    severe: 1,
    high: 5,
    risk: 'Moderate',
    coordinates: [
      [39.7392, -104.9903],
      [39.5296, -104.8700],
      [39.0997, -94.5786]
    ]
  },
  {
    id: 'gamma',
    name: 'Southern Express',
    driver: 'Demo Driver C',
    vehicle: 'Heavy Truck C',
    distance: '1,360 mi',
    duration: '17h 45m',
    status: 'High Risk',
    color: '#f59e0b',
    severe: 3,
    high: 8,
    risk: 'High',
    coordinates: [
      [39.7392, -104.9903],
      [37.6872, -97.3301],
      [36.1540, -95.9928],
      [39.0997, -94.5786]
    ]
  }
]

const demoStops = [
  { name: 'Denver', time: '08:00', distance: 'Start', wind: '12 mph', rain: '0.02 in/hr', snow: '0 in', risk: 'Low' },
  { name: 'Boulder', time: '08:45', distance: '30 mi', wind: '19 mph', rain: '0.05 in/hr', snow: '0 in', risk: 'Low' },
  { name: 'Cheyenne', time: '10:10', distance: '100 mi', wind: '29 mph', rain: '0.12 in/hr', snow: '0 in', risk: 'Moderate' },
  { name: 'Omaha', time: '16:30', distance: '540 mi', wind: '18 mph', rain: '0.03 in/hr', snow: '0 in', risk: 'Low' }
]

function formatDuration(seconds) {
  const totalMinutes = Math.round(Number(seconds || 0) / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

function normalizeRisk(value) {
  if (!value) return 'Pending'

  if (typeof value === 'object') {
    return value.level || value.overall_risk || value.risk || 'Pending'
  }

  return String(value)
}

function getRiskColor(risk) {
  const level = String(risk || 'Pending').toLowerCase()

  if (level === 'low') return '#22c55e'
  if (level === 'moderate') return '#facc15'
  if (level === 'high') return '#f97316'
  if (level === 'severe') return '#ef4444'
  if (level === 'no travel') return '#991b1b'

  return '#94a3b8'
}

function normalizeCheckpoint(cp, index, forecastHour = 0) {
  const forecastList = Array.isArray(cp.weather_forecast)
    ? cp.weather_forecast
    : []

  const selectedForecast =
    forecastList.find(
      item => Number(item.forecast_hour) === Number(forecastHour)
    ) || forecastList[forecastHour] || null

  const weather = selectedForecast || cp.weather || {}

  const risk = normalizeRisk(
    selectedForecast?.risk ||
    selectedForecast?.weather_risk ||
    cp.risk ||
    cp.weather_risk ||
    cp.risk_level
  )

  const latitude = cp.latitude ?? cp.lat
  const longitude = cp.longitude ?? cp.lon ?? cp.lng

  return {
    name: cp.name || `Checkpoint ${index + 1}`,

    time: cp.time
      ? new Date(cp.time).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—',

    distance: cp.distance_miles != null
      ? `${Number(cp.distance_miles).toFixed(1)} mi`
      : '—',

    wind: weather.wind_mph != null
      ? `${Number(weather.wind_mph).toFixed(1)} mph`
      : '—',

    rain: weather.rain_inches != null
      ? `${Number(weather.rain_inches).toFixed(3)} in/hr`
      : '—',

    snow: weather.snow_inches != null
      ? `${Number(weather.snow_inches).toFixed(3)} in/hr`
      : '—',

    risk,

    position: latitude != null && longitude != null
      ? [Number(latitude), Number(longitude)]
      : cp.position || null
  }
}

function buildCheckpoints(route, intervalMiles, departureValue) {
  if (!route?.coordinates?.length) return []

  const totalMiles = Number(route.distanceMiles || 0)
  const interval = Math.max(1, Number(intervalMiles || 25))
  const count = Math.max(0, Math.floor(totalMiles / interval) - 1)
  const points = route.coordinates
  const departureDate = departureValue ? new Date(departureValue) : new Date()

  const checkpoints = [{
    name: 'Origin',
    time: departureDate.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    }),
    distance: 'Start',
    wind: '—',
    rain: '—',
    snow: '—',
    risk: 'Pending',
    position: points[0]
  }]

  for (let i = 1; i <= count; i += 1) {
    const travelled = i * interval
    const fraction = totalMiles ? travelled / totalMiles : 0

    const pointIndex = Math.min(
      points.length - 1,
      Math.round(fraction * (points.length - 1))
    )

    const checkpointTime = new Date(
      departureDate.getTime() + (travelled / 55) * 3600000
    )

    checkpoints.push({
      name: `Checkpoint ${i}`,
      time: checkpointTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }),
      distance: `${travelled} mi`,
      wind: '—',
      rain: '—',
      snow: '—',
      risk: 'Pending',
      position: points[pointIndex]
    })
  }

  checkpoints.push({
    name: 'Destination',
    time: new Date(
      departureDate.getTime() + (totalMiles / 55) * 3600000
    ).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    }),
    distance: `${totalMiles.toFixed(1)} mi`,
    wind: '—',
    rain: '—',
    snow: '—',
    risk: 'Pending',
    position: points[points.length - 1]
  })

  return checkpoints
}

function App() {
  const [routeData, setRouteData] = useState(demoRouteData)
  const [selected, setSelected] = useState('alpha')
  const [origin, setOrigin] = useState('Denver, CO')
  const [destination, setDestination] = useState('Kansas City, MO')
  const [weight, setWeight] = useState('35000')
  const [departure, setDeparture] = useState('2026-11-22T18:00')
  const [forecast, setForecast] = useState(0)
  const [interval, setInterval] = useState('25')
  const [notice, setNotice] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [hasLiveRoutes, setHasLiveRoutes] = useState(false)
  const [recommendedRouteId, setRecommendedRouteId] = useState(null)

  // Admin dropdown state
  const [adminOpen, setAdminOpen] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('spotterLastTrip')
    if (!saved) return

    try {
      const data = JSON.parse(saved)

      if (!Array.isArray(data.routes) || data.routes.length === 0) return

      setOrigin(data.origin || 'Denver, CO')
      setDestination(data.destination || 'Kansas City, MO')
      setWeight(data.weight || '35000')
      setDeparture(data.departure || '2026-11-22T18:00')
      setInterval(data.interval || '25')
      setRouteData(data.routes)
      setSelected(data.recommendedRouteId || data.routes[0].id)
      setRecommendedRouteId(data.recommendedRouteId || null)
      setHasLiveRoutes(true)
      setNotice(`Trip #${data.tripId} restored successfully.`)
    } catch (error) {
      console.error('Could not restore saved trip:', error)
      localStorage.removeItem('spotterLastTrip')
    }
  }, [])

  const active = routeData.find(r => r.id === selected) || routeData[0]

  const stops = hasLiveRoutes && active?.checkpoints?.length
    ? active.checkpoints.map((cp, index) =>
        normalizeCheckpoint(cp, index, forecast)
      )
    : hasLiveRoutes
      ? buildCheckpoints(active, interval, departure)
      : demoStops

  const riskClass = risk => {
    const value = String(risk || 'Pending').toLowerCase()

    if (value === 'low') return 'risk-low'
    if (value === 'moderate') return 'risk-moderate'
    if (value === 'pending') return 'risk-pending'

    return 'risk-high'
  }

  async function generateRoutes(e) {
    e.preventDefault()
    setNotice('')
    setIsSaving(true)

    try {
      const response = await fetch('http://127.0.0.1:8001/api/trips/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          origin: origin.trim(),
          destination: destination.trim(),
          departure_time: new Date(departure).toISOString(),
          load_weight: Number(weight),
          checkpoint_interval: Number(interval)
        })
      })

      const data = await response.json()

      if (!response.ok) {
        const errorDetails = data.errors
          ? Object.entries(data.errors)
              .map(([field, messages]) =>
                `${field}: ${messages.join(', ')}`
              )
              .join(' | ')
          : (data.message || 'Unable to save trip.')

        throw new Error(errorDetails)
      }

      if (!data.route_data?.routes?.length) {
        throw new Error(
          data.route_error || 'Trip saved, but no route options were returned.'
        )
      }

      const colors = ['#ff922e', '#39d5f5', '#f59e0b', '#a78bfa']

      const liveRoutes = data.route_data.routes.map((route, index) => {
        const risk = normalizeRisk(
          route.overall_risk || route.risk || route.status
        )

        const checkpoints = Array.isArray(route.checkpoints)
          ? route.checkpoints
          : []

        return {
          id: route.id,
          name: `Route ${index + 1}`,
          driver: 'Route calculated by OSRM',
          vehicle: 'Truck route option',
          distanceMiles: Number(route.distance_miles || 0),
          distance: `${Number(route.distance_miles || 0).toLocaleString(
            undefined,
            { maximumFractionDigits: 1 }
          )} mi`,
          duration: formatDuration(route.duration_seconds),
          status: risk,
          color: colors[index % colors.length],
          severe: route.severe_miles ?? route.risk_miles?.Severe ?? '—',
          high: route.high_miles ?? route.risk_miles?.High ?? '—',
          risk,
          coordinates: route.coordinates || [],
          checkpoints
        }
      })

      const recommendedId = data.route_data.recommended_route_id || null

      setRouteData(liveRoutes)
      setRecommendedRouteId(recommendedId)
      setSelected(recommendedId || liveRoutes[0].id)
      setForecast(0)
      setHasLiveRoutes(true)

      localStorage.setItem('spotterLastTrip', JSON.stringify({
        tripId: data.trip.id,
        origin,
        destination,
        weight,
        departure,
        interval,
        recommendedRouteId: recommendedId,
        routes: liveRoutes
      }))

      const weatherAvailable = liveRoutes.some(
        route => route.checkpoints.some(
          cp => cp.weather || cp.weather_forecast?.length
        )
      )

      setNotice(
        `Trip #${data.trip.id} saved. ${liveRoutes.length} real route option(s) loaded. ${
          weatherAvailable
            ? 'Weather checkpoint data received.'
            : 'Weather data is still pending.'
        }`
      )
    } catch (error) {
      console.error('Unable to generate routes:', error)
      setNotice(
        `Could not generate routes: ${error.message}. Check the backend terminal.`
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="dashboard">

      <header className="top-nav">
        <div className="brand">
          <div className="brand-symbol">
            <Navigation size={23} />
          </div>
          <span>spotter <b>AI</b></span>
        </div>

        <nav className="main-nav">
          <a className="nav-active" href="#dashboard">Dashboard</a>
          <a href="#routes">Routes</a>
          <a href="#weather">Weather</a>
          <a href="#analytics">Analytics</a>
          <a href="#alerts">Alerts</a>
        </nav>

        <div className="nav-right">
          <span className="system-online"><i /> SYSTEM ONLINE</span>

          <button
            type="button"
            className="nav-icon"
            aria-label="Notifications"
          >
            <Bell size={18} />
          </button>

          <button
            type="button"
            className="nav-icon"
            aria-label="Settings"
          >
            <Settings size={18} />
          </button>

          {/* ADMIN DROPDOWN */}
          <div className="admin-menu">
            <button
              type="button"
              className="admin-trigger"
              aria-expanded={adminOpen}
              onClick={() => setAdminOpen(prev => !prev)}
            >
              <div className="admin-avatar">SA</div>

              <span className="admin-name">
                Admin
                <ChevronDown
                  size={13}
                  className={adminOpen ? 'admin-chevron-open' : ''}
                />
              </span>
            </button>

            {adminOpen && (
              <div className="admin-dropdown">
                <div className="admin-dropdown-header">
                  <strong>Admin</strong>
                  <small>Administrator account</small>
                </div>

                <button
                  type="button"
                  onClick={() => setAdminOpen(false)}
                >
                  My Profile
                </button>

                <button
                  type="button"
                  onClick={() => setAdminOpen(false)}
                >
                  Account Settings
                </button>

                <div className="admin-dropdown-divider" />

                <button
                  type="button"
                  className="admin-logout"
                  onClick={() => setAdminOpen(false)}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main id="dashboard">

        <section className="toolbar">
          <div className="toolbar-title">
            <span className="orange-mark" /> ROUTE OPERATIONS
          </div>

          <div className="toolbar-right">
            <span className="demo-label">ASSESSMENT PREVIEW</span>

            <button
              className="reoptimize"
              onClick={() => {
                setNotice('')
                setRouteData(demoRouteData)
                setSelected('alpha')
                setRecommendedRouteId(null)
                setHasLiveRoutes(false)
                setForecast(0)
                localStorage.removeItem('spotterLastTrip')
              }}
            >
              <RefreshCw size={15} /> Reset preview
            </button>
          </div>
        </section>

        <section className="trip-bar">
          <form onSubmit={generateRoutes} className="trip-form">

            <div className="trip-field">
              <label><MapPin size={13} /> ORIGIN</label>
              <input
                value={origin}
                onChange={e => setOrigin(e.target.value)}
                required
              />
            </div>

            <div className="trip-field">
              <label><Navigation size={13} /> DESTINATION</label>
              <input
                value={destination}
                onChange={e => setDestination(e.target.value)}
                required
              />
            </div>

            <div className="trip-field">
              <label><CalendarDays size={13} /> DEPARTURE</label>
              <input
                type="datetime-local"
                value={departure}
                onChange={e => setDeparture(e.target.value)}
                required
              />
            </div>

            <div className="trip-field weight-field">
              <label><Truck size={13} /> LOAD (LB)</label>
              <input
                type="number"
                min="1"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                required
              />
            </div>

            <button className="create-route" type="submit" disabled={isSaving}>
              <Search size={16} />
              {isSaving ? 'Generating...' : 'Generate routes'}
            </button>
          </form>

          {notice && <div className="notice">{notice}</div>}
        </section>

        <section className="kpi-grid" id="analytics">

          <div className="kpi-card">
            <div className="kpi-icon orange-icon"><Route /></div>
            <div>
              <small>TOTAL ROUTES</small>
              <strong>{routeData.length.toString().padStart(2, '0')}</strong>
              <span>Driving options</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon cyan-icon"><ShieldCheck /></div>
            <div>
              <small>SAFEST ROUTE</small>
              <strong>
                {hasLiveRoutes
                  ? recommendedRouteId
                    ? routeData.find(r => r.id === recommendedRouteId)?.name || active.name
                    : active.risk
                  : 'Alpha'}
              </strong>
              <span>
                {hasLiveRoutes
                  ? recommendedRouteId
                    ? 'Backend recommendation'
                    : 'Based on route risk'
                  : 'Demo preview'}
              </span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon purple-icon"><Clock /></div>
            <div>
              <small>TRAVEL TIME</small>
              <strong>{active.duration}</strong>
              <span>Selected route estimate</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon green-icon"><Gauge /></div>
            <div>
              <small>TRUCK LOAD</small>
              <strong>{Number(weight || 0).toLocaleString()} lb</strong>
              <span>Entered cargo weight</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon red-icon"><AlertTriangle /></div>
            <div>
              <small>SEVERE MILES</small>
              <strong>{active.severe}</strong>
              <span>{hasLiveRoutes ? 'Route risk analysis' : 'Demo preview'}</span>
            </div>
          </div>

        </section>

        <section className="operations-grid" id="routes">

          <aside className="routes-column">

            <div className="column-heading">
              <div>
                <h2>Routes</h2>
                <p>{routeData.length} available options</p>
              </div>

              <button className="nav-icon">
                <Settings size={17} />
              </button>
            </div>

            <div className="route-cards">
              {routeData.map(route => (
                <button
                  key={route.id}
                  onClick={() => {
                    setSelected(route.id)
                    setForecast(0)
                  }}
                  className={`route-item ${selected === route.id ? 'route-selected' : ''}`}
                  style={{ '--route-color': route.color }}
                >
                  <div className="route-item-top">
                    <span className="route-dot" />
                    <strong>{route.name}</strong>
                    <span className={`route-status ${riskClass(route.risk)}`}>
                      {route.status}
                    </span>
                  </div>

                  <div className="route-driver">
                    <Truck size={13} /> {route.driver}
                  </div>

                  <div className="route-driver">
                    <Gauge size={13} /> {route.vehicle}
                  </div>

                  <div className="route-item-metrics">
                    <div>
                      <strong>{route.severe}</strong>
                      <small>Severe mi</small>
                    </div>

                    <div>
                      <strong>{route.high}</strong>
                      <small>High mi</small>
                    </div>

                    <div>
                      <strong>{route.duration}</strong>
                      <small>Duration</small>
                    </div>
                  </div>

                  {selected === route.id && (
                    <div className="route-active-label">
                      SELECTED ROUTE <ArrowUpRight size={12} />
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className="route-summary-mini">
              <ShieldCheck size={18} />
              <div>
                <strong>Recommendation</strong>
                <p>
                  {hasLiveRoutes
                    ? recommendedRouteId
                      ? 'Safest route selected using backend risk analysis.'
                      : 'Real driving route loaded. Route risk is shown when returned by the backend.'
                    : 'Northern Express is the sample route shown in the preview.'}
                </p>
              </div>
            </div>

          </aside>

          <section className="map-column">

            <div className="map-heading">
              <div>
                <h2>Route map</h2>
                <p>{origin} → {destination}</p>
              </div>

              <div className="map-actions">
                <button><Layers size={15} /> Layers</button>
                <button><Activity size={15} /> Weather</button>
              </div>
            </div>

            <div className="map-stage">

              <MapContainer
                key={`${hasLiveRoutes ? active.id : 'demo'}-${origin}-${destination}`}
                center={
                  active.coordinates[Math.floor(active.coordinates.length / 2)] ||
                  [39.7, -99.7]
                }
                zoom={hasLiveRoutes ? 8 : 4}
                scrollWheelZoom={true}
                className="ops-map"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {routeData.map(route => (
                  <Polyline
                    key={route.id}
                    positions={route.coordinates}
                    pathOptions={{
                      color: route.color,
                      weight: selected === route.id ? 5 : 3,
                      opacity: selected === route.id ? 1 : 0.55,
                      dashArray: !hasLiveRoutes && route.id === 'gamma'
                        ? '8 8'
                        : undefined
                    }}
                  />
                ))}

                {active.coordinates?.length > 0 && (
                  <>
                    <CircleMarker
                      center={active.coordinates[0]}
                      radius={7}
                      pathOptions={{
                        color: '#fff',
                        fillColor: '#ff922e',
                        fillOpacity: 1
                      }}
                    >
                      <Popup>Origin: {origin}</Popup>
                    </CircleMarker>

                    <CircleMarker
                      center={active.coordinates[active.coordinates.length - 1]}
                      radius={7}
                      pathOptions={{
                        color: '#fff',
                        fillColor: '#39d5f5',
                        fillOpacity: 1
                      }}
                    >
                      <Popup>Destination: {destination}</Popup>
                    </CircleMarker>

                    {hasLiveRoutes && stops.map((stop, index) =>
                      stop.position ? (
                        <React.Fragment key={`${stop.name}-${index}`}>
                          <Circle
                            center={stop.position}
                            radius={18000}
                            pathOptions={{
                              color: getRiskColor(stop.risk),
                              fillColor: getRiskColor(stop.risk),
                              fillOpacity: 0.18,
                              weight: 1,
                              opacity: 0.45
                            }}
                          />

                          <CircleMarker
                            center={stop.position}
                            radius={7}
                            pathOptions={{
                              color: '#ffffff',
                              weight: 2,
                              fillColor: getRiskColor(stop.risk),
                              fillOpacity: 0.95
                            }}
                          >
                            <Popup>
                              <strong>{stop.name}</strong>
                              <br />
                              Forecast: +{forecast} hours
                              <br />
                              Distance: {stop.distance}
                              <br />
                              Risk: {stop.risk}
                              <br />
                              Wind: {stop.wind}
                              <br />
                              Rain: {stop.rain}
                              <br />
                              Snow: {stop.snow}
                            </Popup>
                          </CircleMarker>
                        </React.Fragment>
                      ) : null
                    )}
                  </>
                )}

              </MapContainer>

              <div className="map-overlay-tag">
                <span />
                {hasLiveRoutes ? 'LIVE DRIVING ROUTES' : 'DEMO MAP PREVIEW'}
              </div>

              <div className="map-overlay-bottom">
                {routeData.map(route => (
                  <span key={route.id}>
                    <i style={{ background: route.color }} /> {route.name}
                  </span>
                ))}
              </div>

            </div>

            <div className="map-footer">
              <span><MapPin size={14} /> {origin}</span>
              <ArrowUpRight size={14} />
              <span><MapPin size={14} /> {destination}</span>
              <span className="map-footer-distance">{active.distance}</span>
            </div>

          </section>

          <aside className="details-column">

            <div className="details-heading">
              <div>
                <small>SELECTED ROUTE</small>
                <h2>{active.name}</h2>
              </div>

              <span className={`route-status ${riskClass(active.risk)}`}>
                {active.risk}
              </span>
            </div>

            <div className="details-tabs">
              <span className="tab-active">Timeline</span>
              <span>Risk summary</span>
            </div>

            <div className="timeline">
              {stops.map((stop, index) => (
                <div className="timeline-item" key={`${stop.name}-${index}`}>
                  <div className="timeline-marker">
                    {index === 0 ? <Navigation size={13} /> : index + 1}
                  </div>

                  <div className="timeline-content">
                    <div className="timeline-top">
                      <strong>{stop.name}</strong>
                      <span>{stop.time}</span>
                    </div>

                    <small>{stop.distance} checkpoint</small>

                    <div className={`checkpoint-risk ${riskClass(stop.risk)}`}>
                      {stop.risk} weather risk
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="detail-stats">
              <div>
                <span><Route size={14} /> Distance</span>
                <strong>{active.distance}</strong>
              </div>

              <div>
                <span><Clock size={14} /> Duration</span>
                <strong>{active.duration}</strong>
              </div>

              <div>
                <span><AlertTriangle size={14} /> Severe miles</span>
                <strong>{active.severe}</strong>
              </div>

              <div>
                <span><Zap size={14} /> High-risk miles</span>
                <strong>{active.high}</strong>
              </div>

              <div>
                <span><Truck size={14} /> Truck load</span>
                <strong>{Number(weight || 0).toLocaleString()} lb</strong>
              </div>
            </div>

            <div className="detail-note">
              <ShieldCheck size={17} />
              <div>
                <strong>Route assessment</strong>
                <p>
                  {hasLiveRoutes
                    ? active.checkpoints?.some(
                        cp => cp.weather || cp.weather_forecast?.length
                      )
                      ? 'Road route and weather checkpoint forecast data received from backend services.'
                      : 'Road geometry is live. Weather checkpoint data was not returned for this route.'
                    : 'Demo preview data. Generate a trip to load real driving routes.'}
                </p>
              </div>
            </div>

          </aside>
        </section>

        <section className="weather-panel" id="weather">

          <div className="weather-title">
            <div>
              <h2><CloudRain size={18} /> Weather intelligence</h2>
              <p>
                {hasLiveRoutes
                  ? 'Route checkpoints · forecast conditions'
                  : 'Checkpoint conditions and forecast preview'}
              </p>
            </div>

            <div className="interval-control">
              <label>CHECKPOINT INTERVAL</label>
              <select
                value={interval}
                onChange={e => setInterval(e.target.value)}
              >
                <option value="10">10 miles</option>
                <option value="25">25 miles</option>
                <option value="50">50 miles</option>
              </select>
            </div>
          </div>

          <div className="forecast-bar">
            <div>
              <Clock size={15} />
              Forecast <strong>+{forecast}h</strong>
            </div>

            <input
              type="range"
              min="0"
              max="48"
              step="1"
              value={forecast}
              onChange={e => setForecast(Number(e.target.value))}
            />

            <span>+48 hours</span>
          </div>

          <div className="weather-grid">
            {stops.map((stop, index) => (
              <div className="weather-card" key={`${stop.name}-${index}`}>
                <div className="weather-city">
                  <MapPin size={14} /> {stop.name}
                </div>

                <div className="weather-value">
                  <Wind size={17} />
                  <strong>{stop.wind}</strong>
                </div>
                <small>Wind speed</small>

                <div className="weather-value">
                  <CloudRain size={17} />
                  <strong>{stop.rain}</strong>
                </div>
                <small>Rainfall</small>

                <div className="weather-value">
                  <CloudRain size={17} />
                  <strong>{stop.snow}</strong>
                </div>
                <small>Snowfall</small>

                <span className={`route-status ${riskClass(stop.risk)}`}>
                  {stop.risk}
                </span>
              </div>
            ))}
          </div>

          <p className="sample-warning">
            <AlertTriangle size={14} />
            {hasLiveRoutes && active.checkpoints?.some(
              cp => cp.weather || cp.weather_forecast?.length
            )
              ? `Weather forecast displayed for +${forecast} hours.`
              : hasLiveRoutes
                ? 'Weather data is unavailable or pending for this route.'
                : 'Demo weather preview. Generate a trip to load route data.'}
          </p>

        </section>

        <footer className="footer">
          <span>SPOTTER AI · WEATHER-AWARE TRUCK ROUTING</span>
          <span>FULL STACK DEVELOPER ASSESSMENT</span>
        </footer>

      </main>
    </div>
  )
}

export default App
