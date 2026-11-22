import json
import urllib.parse
import urllib.request

from datetime import datetime, timezone, timedelta


WEATHER_URL = "https://api.open-meteo.com/v1/forecast"

RISK_RANKING = {
    "Low": 0,
    "Moderate": 1,
    "High": 2,
    "Severe": 3,
    "No Travel": 4,
}


def fetch_weather_data(latitude, longitude):
    params = urllib.parse.urlencode({
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "precipitation,snowfall,wind_speed_10m",
        "forecast_days": 3,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "UTC",
    })

    request = urllib.request.Request(
        f"{WEATHER_URL}?{params}",
        headers={
            "User-Agent": "SpotterAI-TruckRouting/1.0",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        raise RuntimeError(f"Weather API request failed: {error}")

    if "hourly" not in data:
        raise RuntimeError("Weather API returned no hourly forecast.")

    return data["hourly"]


def normalize_time(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value)

    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc).replace(tzinfo=None)


def weather_at_index(hourly, index):
    wind = hourly["wind_speed_10m"][index] or 0
    rain = hourly["precipitation"][index] or 0
    snow_cm = hourly["snowfall"][index] or 0

    return {
        "time": hourly["time"][index],
        "wind_mph": round(float(wind), 2),
        "rain_inches": round(float(rain), 3),
        "snow_inches": round(float(snow_cm) / 2.54, 3),
    }


def get_weather(latitude, longitude, checkpoint_time):
    """Get weather nearest to the truck's estimated checkpoint arrival."""

    hourly = fetch_weather_data(latitude, longitude)

    required = [
        "time",
        "precipitation",
        "snowfall",
        "wind_speed_10m",
    ]

    for field in required:
        if field not in hourly or not hourly[field]:
            raise RuntimeError(f"Missing weather forecast field: {field}")

    target = normalize_time(checkpoint_time)

    forecast_times = [
        normalize_time(value)
        for value in hourly["time"]
    ]

    index = min(
        range(len(forecast_times)),
        key=lambda i: abs((forecast_times[i] - target).total_seconds()),
    )

    difference = abs(
        (forecast_times[index] - target).total_seconds()
    )

    if difference > 3600:
        raise RuntimeError(
            "No suitable hourly forecast for this checkpoint time."
        )

    return weather_at_index(hourly, index)


def get_weather_forecast(latitude, longitude, checkpoint_time):
    """Return hourly forecast from checkpoint ETA through the next 48 hours."""

    hourly = fetch_weather_data(latitude, longitude)

    required = [
        "time",
        "precipitation",
        "snowfall",
        "wind_speed_10m",
    ]

    for field in required:
        if field not in hourly or not hourly[field]:
            raise RuntimeError(f"Missing weather forecast field: {field}")

    target = normalize_time(checkpoint_time)

    forecast_times = [
        normalize_time(value)
        for value in hourly["time"]
    ]

    start_index = min(
        range(len(forecast_times)),
        key=lambda i: abs((forecast_times[i] - target).total_seconds()),
    )

    forecasts = []

    for offset in range(49):
        index = start_index + offset

        if index >= len(forecast_times):
            break

        weather = weather_at_index(hourly, index)
        weather["forecast_hour"] = offset
        forecasts.append(weather)

    return forecasts


def classify_weather(weather, load_weight):
    wind = float(weather.get("wind_mph", 0))
    rain = float(weather.get("rain_inches", 0))
    snow = float(weather.get("snow_inches", 0))

    if wind >= 55:
        wind_risk = "No Travel"
    elif wind >= 45:
        wind_risk = "Severe"
    elif wind >= 35:
        wind_risk = "High"
    elif wind >= 25:
        wind_risk = "Moderate"
    else:
        wind_risk = "Low"

    if rain > 1.0:
        rain_risk = "No Travel"
    elif rain >= 0.50:
        rain_risk = "Severe"
    elif rain >= 0.25:
        rain_risk = "High"
    elif rain >= 0.10:
        rain_risk = "Moderate"
    else:
        rain_risk = "Low"

    if snow > 3.0:
        snow_risk = "No Travel"
    elif snow >= 2.0:
        snow_risk = "Severe"
    elif snow >= 1.0:
        snow_risk = "High"
    elif snow >= 0.5:
        snow_risk = "Moderate"
    else:
        snow_risk = "Low"

    risks = [wind_risk, rain_risk, snow_risk]

    if 45 <= wind < 55 and load_weight > 30000:
        risks.append("No Travel")

    if 35 <= wind < 45 and load_weight > 40000:
        risks.append("Severe")

    overall_risk = max(
        risks,
        key=lambda risk: RISK_RANKING[risk],
    )

    return {
        "level": overall_risk,
        "wind_risk": wind_risk,
        "rain_risk": rain_risk,
        "snow_risk": snow_risk,
        "wind_mph": wind,
        "rain_inches": rain,
        "snow_inches": round(snow, 3),
    }