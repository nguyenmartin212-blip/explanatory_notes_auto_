from types import SimpleNamespace

from app.services.geo_service import find_nearby, haversine_m


def test_haversine_same_point_is_zero():
    assert haversine_m(10.0, 106.0, 10.0, 106.0) == 0


def test_haversine_hanoi_to_hcmc_about_1150km():
    d = haversine_m(21.0285, 105.8542, 10.7769, 106.7009)
    assert 1_100_000 < d < 1_200_000


def test_find_nearby_filters_and_sorts():
    near = SimpleNamespace(latitude=10.0001, longitude=106.0, trigger_radius=50, audio_priority=0)
    mid = SimpleNamespace(latitude=10.002, longitude=106.0, trigger_radius=50, audio_priority=0)
    far = SimpleNamespace(latitude=11.0, longitude=106.0, trigger_radius=50, audio_priority=0)
    result = find_nearby([far, mid, near], 10.0, 106.0, 1000)
    assert [p for p, _, _ in result] == [near, mid]   # 'far' bị loại, gần nhất đứng đầu
    assert result[0][2] is True                        # near nằm trong vùng kích hoạt 50 m
    assert result[1][2] is False                       # mid (~220 m) thì không
