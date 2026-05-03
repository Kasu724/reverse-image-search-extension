API_KEY = "dev_imagelab_key"
ONE_PIXEL_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def test_usage_requires_api_key(client):
    response = client.get("/api/cloud/usage")
    assert response.status_code == 401


def test_usage_for_seeded_pro_user(client):
    response = client.get("/api/cloud/usage", headers={"X-API-Key": API_KEY})
    assert response.status_code == 200
    payload = response.json()
    assert payload["plan"] == "pro"
    assert payload["limit"] == 300


def test_cloud_search_returns_mock_results_and_records_usage(client):
    response = client.post(
        "/api/cloud/search",
        headers={"X-API-Key": API_KEY},
        json={
            "image_url": "https://example.com/image.jpg",
            "page_url": "https://example.com/page",
            "enabled_engines": ["google", "saucenao"],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["results"]) == 2
    assert payload["results"][1]["engine"] == "SauceNAO"
    assert payload["usage"]["used"] >= 1


def test_batch_search_counts_each_image(client):
    response = client.post(
        "/api/cloud/batch-search",
        headers={"X-API-Key": API_KEY},
        json={
            "image_urls": [
                "https://example.com/one.jpg",
                "https://example.com/two.jpg",
            ],
            "enabled_engines": ["tineye"],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 2
    assert payload["items"][0]["results"][0]["engine"] == "TinEye"


def test_cloud_analyze_returns_mock_hints(client):
    response = client.post(
        "/api/cloud/analyze",
        headers={"X-API-Key": API_KEY},
        json={"image_url": "https://example.com/image.jpg"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "suggested_queries" in payload


def test_upload_image_returns_public_file_url(client):
    response = client.post(
        "/api/cloud/upload-image",
        headers={"X-API-Key": API_KEY},
        json={"image_data_url": ONE_PIXEL_PNG, "filename": "pixel.png"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["content_type"] == "image/png"
    assert payload["size_bytes"] > 0
    assert "/api/cloud/uploads/" in payload["image_url"]

    file_response = client.get(payload["image_url"].replace("http://testserver", ""))
    assert file_response.status_code == 200
    assert file_response.headers["content-type"] == "image/png"
