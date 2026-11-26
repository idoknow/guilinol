"""Store a vehicle roadbed without creating railway layers on rail-free tiles."""


def roadbed(collision):
    streets = collision[1]
    if len(streets) > 17:
        return streets[17]
    return collision[7] if len(collision) > 7 else None


def set_roadbed(collision, bed):
    if len(collision) >= 7:
        collision[7:8] = [bed]
        return
    streets = collision[1]
    if bed is None and len(streets) <= 17:
        return
    while len(streets) < 17:
        streets.append(None if len(streets) in (5, 11, 12, 16) else {} if len(streets) == 13 else [])
    streets[17:18] = [bed]
