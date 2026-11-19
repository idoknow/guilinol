def return_trips(routes):
    kept=list(routes)
    incoming={(leg['kind'],leg['end']):leg for leg in routes}
    outgoing={(leg['kind'],leg['start']) for leg in routes}
    for leg in routes:
        if (leg['kind'],leg['end']) not in outgoing:
            while leg:
                kept.append(dict(kind=leg['kind'],start=leg['end'],end=leg['start'],path=leg['path'][::-1]))
                leg=incoming.get((leg['kind'],leg['start']))
    return kept
