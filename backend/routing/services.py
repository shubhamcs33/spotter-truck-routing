
import json
import math
import urllib.parse
import urllib.request

from datetime import timedelta

from .weather import (
    get_weather,
    get_weather_forecast,
    classify_weather,
)


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"


def fetch_json(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SpotterAI-TruckRouting/1.0",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as error:
        raise RuntimeError(
            f"External API request failed: {error}"
        )


def geocode_location(place):
    params = urllib.parse.urlencode({
        "q": place,
        "format": "jsonv2",
        "limit": 1,
    })

    data = fetch_json(f"{NOMINATIM_URL}?{params}")

    if not data:
        raise ValueError(f"Location not found: {place}")

    return {
        "latitude": float(data[0]["lat"]),
        "longitude": float(data[0]["lon"]),
        "display_name": data[0]["display_name"],
    }


def get_route_options(origin, destination):
    start = geocode_location(origin)
    end = geocode_location(destination)

    start_point = [
        start["longitude"],
        start["latitude"],
    ]

    end_point = [
        end["longitude"],
        end["latitude"],
    ]

    params = urllib.parse.urlencode({
        "alternatives": "true",
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        "continue_straight": "false",
    })

    direct_coordinates = (
        f"{start_point[0]},{start_point[1]};"
        f"{end_point[0]},{end_point[1]}"
    )

    data = fetch_json(
        f"{OSRM_URL}/{direct_coordinates}?{params}"
    )

    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError("No driving routes were found.")

    candidate_routes = list(data["routes"])

    # Try different intermediate waypoints to find
    # additional genuine driving paths.
    mid_lat = (
        start_point[1] + end_point[1]
    ) / 2

    mid_lon = (
        start_point[0] + end_point[0]
    ) / 2

    dx = (
        (end_point[0] - start_point[0])
        * math.cos(math.radians(mid_lat))
    )

    dy = end_point[1] - start_point[1]

    length = math.sqrt(dx * dx + dy * dy)

    if length > 0:
        perp_x = -dy / length
        perp_y = dx / length

        for offset_km in (8, -8, 15, -15, 25, -25):
            offset_lon = (
                perp_x * offset_km
                / (
                    111
                    * math.cos(math.radians(mid_lat))
                )
            )

            offset_lat = perp_y * offset_km / 111

            waypoint = [
                mid_lon + offset_lon,
                mid_lat + offset_lat,
            ]

            route_coordinates = (
                f"{start_point[0]},{start_point[1]};"
                f"{waypoint[0]},{waypoint[1]};"
                f"{end_point[0]},{end_point[1]}"
            )

            waypoint_params = urllib.parse.urlencode({
                "alternatives": "false",
                "overview": "full",
                "geometries": "geojson",
                "steps": "true",
                "continue_straight": "false",
            })

            try:
                waypoint_data = fetch_json(
                    f"{OSRM_URL}/{route_coordinates}?"
                    f"{waypoint_params}"
                )

                if (
                    waypoint_data.get("code") == "Ok"
                    and waypoint_data.get("routes")
                ):
                    candidate_routes.append(
                        waypoint_data["routes"][0]
                    )

            except Exception:
                continue

    routes = []
    seen_paths = set()

    for route in candidate_routes:
        geometry = route["geometry"]["coordinates"]

        if len(geometry) < 2:
            continue

        sample_indices = [
            round(i * (len(geometry) - 1) / 7)
            for i in range(8)
        ]

        signature = tuple(
            (
                round(geometry[i][0], 3),
                round(geometry[i][1], 3),
            )
            for i in sample_indices
        )

        if signature in seen_paths:
            continue

        seen_paths.add(signature)

        route_number = len(routes) + 1

        routes.append({
            "id": f"route-{route_number}",
            "name": f"Route {route_number}",
            "distance_miles": round(
                route["distance"] / 1609.344,
                2,
            ),
            "duration_seconds": round(
                route["duration"]
            ),
            "duration_hours": round(
                route["duration"] / 3600,
                2,
            ),
            "coordinates": [
                [latitude, longitude]
                for longitude, latitude in geometry
            ],
            "geometry": geometry,
        })

        if len(routes) == 3:
            break

    if not routes:
        raise RuntimeError(
            "No valid driving routes were found."
        )

    return {
        "origin": start,
        "destination": end,
        "route_count": len(routes),
        "routes": routes,
        "route_provider": "OSRM",
        "route_message": (
            f"{len(routes)} distinct driving route "
            "option(s) returned."
        ),
    }


def haversine_miles(point_a, point_b):
    lon1, lat1 = map(math.radians, point_a)
    lon2, lat2 = map(math.radians, point_b)

    dlon = lon2 - lon1
    dlat = lat2 - lat1

    value = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(dlon / 2) ** 2
    )

    value = max(0, min(1, value))

    return 3958.8 * 2 * math.atan2(
        math.sqrt(value),
        math.sqrt(1 - value),
    )


def coordinate_at_distance(geometry, target_miles):
    if not geometry:
        raise ValueError("Route geometry is empty.")

    travelled = 0.0

    for index in range(1, len(geometry)):
        previous = geometry[index - 1]
        current = geometry[index]

        segment = haversine_miles(
            previous,
            current,
        )

        if travelled + segment >= target_miles:
            fraction = (
                (target_miles - travelled) / segment
                if segment else 0
            )

            longitude = previous[0] + (
                current[0] - previous[0]
            ) * fraction

            latitude = previous[1] + (
                current[1] - previous[1]
            ) * fraction

            return [longitude, latitude]

        travelled += segment

    return geometry[-1]


def enrich_routes_with_weather(
    route_data,
    departure_time,
    load_weight,
    checkpoint_interval,
):
    ranking = {
        "Low": 0,
        "Moderate": 1,
        "High": 2,
        "Severe": 3,
        "No Travel": 4,
        "Pending": 5,
    }

    for route in route_data["routes"]:
        distance = route["distance_miles"]
        duration = route["duration_seconds"]
        geometry = route["geometry"]

        if distance <= 0:
            raise ValueError(
                "Route distance must be greater than zero."
            )

        checkpoints = []

        risk_miles = {
            "Low": 0,
            "Moderate": 0,
            "High": 0,
            "Severe": 0,
            "No Travel": 0,
            "Pending": 0,
        }

        distances = list(
            range(
                int(checkpoint_interval),
                int(distance),
                int(checkpoint_interval),
            )
        )

        distances.append(distance)

        previous_distance = 0.0
        weighted_risk_total = 0.0

        for number, travelled in enumerate(
            distances,
            start=1,
        ):
            fraction = travelled / distance

            checkpoint_time = departure_time + timedelta(
                seconds=duration * fraction
            )

            longitude, latitude = coordinate_at_distance(
                geometry,
                travelled,
            )

            checkpoint = {
                "name": (
                    "Destination"
                    if travelled >= distance
                    else f"Checkpoint {number}"
                ),
                "distance_miles": round(
                    travelled,
                    2,
                ),
                "latitude": latitude,
                "longitude": longitude,
                "time": checkpoint_time.isoformat(),
            }

            try:
                weather = get_weather(
                    latitude,
                    longitude,
                    checkpoint_time,
                )

                risk = classify_weather(
                    weather,
                    load_weight,
                )

                forecast_data = get_weather_forecast(
                    latitude,
                    longitude,
                    checkpoint_time,
                )

                for forecast_item in forecast_data:
                    forecast_item["risk"] = classify_weather(
                        forecast_item,
                        load_weight,
                    )

                checkpoint["weather"] = weather
                checkpoint["risk"] = risk
                checkpoint["weather_forecast"] = forecast_data

                level = risk["level"]

                if level not in ranking:
                    level = "Pending"

            except Exception as error:
                checkpoint["weather"] = None

                checkpoint["risk"] = {
                    "level": "Pending",
                    "error": str(error),
                }

                checkpoint["weather_forecast"] = []

                level = "Pending"

            segment_miles = max(
                0,
                travelled - previous_distance,
            )

            risk_miles[level] += segment_miles

            weighted_risk_total += (
                ranking[level] * segment_miles
            )

            previous_distance = travelled
            checkpoints.append(checkpoint)

        levels = [
            checkpoint["risk"]["level"]
            for checkpoint in checkpoints
        ]

        overall = max(
            levels,
            key=lambda item: ranking.get(item, 5),
        )

        average_risk = (
            weighted_risk_total / distance
        )

        route["checkpoints"] = checkpoints
        route["overall_risk"] = overall

        route["risk_miles"] = {
            key: round(value, 2)
            for key, value in risk_miles.items()
        }

        route["severe_miles"] = round(
            risk_miles["Severe"]
            + risk_miles["No Travel"],
            2,
        )

        route["high_miles"] = round(
            risk_miles["High"],
            2,
        )

        route["no_travel_miles"] = round(
            risk_miles["No Travel"],
            2,
        )

        route["average_risk_score"] = round(
            average_risk,
            2,
        )

    # Rank routes by weather risk first,
    # then by travel time.
    route_data["routes"].sort(
        key=lambda route: (
            route["severe_miles"],
            route["high_miles"],
            route["average_risk_score"],
            route["duration_seconds"],
        )
    )

    route_data["recommended_route_id"] = (
        route_data["routes"][0]["id"]
        if route_data["routes"]
        else None
    )

    return route_data
