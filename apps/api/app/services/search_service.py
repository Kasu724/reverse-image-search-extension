from app.schemas import SearchResult


ENGINE_LABELS = {
    "google": "Google Images",
    "bing": "Bing Visual Search",
    "tineye": "TinEye",
    "yandex": "Yandex Images",
    "saucenao": "SauceNAO",
}


def mock_search_results(
    image_url: str,
    page_url: str | None,
    enabled_engines: list[str],
) -> list[SearchResult]:
    engines = enabled_engines or list(ENGINE_LABELS)
    source_hint = page_url or image_url
    return [
        SearchResult(
            engine=ENGINE_LABELS.get(engine, engine.title()),
            title=f"Mock match from {ENGINE_LABELS.get(engine, engine.title())}",
            url=f"https://example.com/imagelab/mock/{engine}?image={engine}",
            thumbnail_url=image_url if image_url.startswith(("http://", "https://")) else None,
            snippet=(
                "Normalized demo result for ImageLab cloud mode. "
                f"Source context: {source_hint[:120]}"
            ),
            confidence=max(0.62, 0.92 - index * 0.07),
        )
        for index, engine in enumerate(engines)
    ]
