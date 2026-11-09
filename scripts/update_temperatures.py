#!/usr/bin/env python3
"""
Script para baixar a malha municipal de Minas Gerais (UF 31 - 853 municípios) na API do IBGE
com generalização cartográfica compatível com escala estadual (`qualidade=minima` + quantização
de precisão de coordenadas para 4 casas decimais) e coletar as temperaturas reais em tempo real
(atual, mínima e máxima diária) via API pública Open-Meteo, armazenando tudo no mesmo arquivo
GeoJSON (`data/minas_gerais_municipios.geojson`).
"""

import concurrent.futures
import datetime
import json
import logging
import os
import time
from typing import Dict, List, Optional, Tuple

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

# Minas Gerais = UF 31 (853 municípios)
IBGE_MUNICIPIOS_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/31/municipios"
# Generalização cartográfica do IBGE compatível com visualização em escala estadual (qualidade=minima)
IBGE_MALHA_URL = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/31"
    "?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio"
)
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEOJSON_PATH = os.path.join(BASE_DIR, "data", "minas_gerais_municipios.geojson")
OLD_PR_GEOJSON_PATH = os.path.join(BASE_DIR, "data", "parana_municipios.geojson")


def generalize_ring(ring: List[List[float]], precision: int = 4) -> List[List[float]]:
    """
    Aplica truncamento de precisão de coordenadas (4 casas decimais ~ 11m, ideal para escala estadual)
    e remove vértices consecutivos colineares/duplicados gerados pelo arredondamento, preservando
    o fechamento topológico de anéis válidos (>= 4 pontos).
    """
    if not ring:
        return ring
    dedup: List[List[float]] = []
    for pt in ring:
        rounded = [round(float(pt[0]), precision), round(float(pt[1]), precision)]
        if not dedup or dedup[-1] != rounded:
            dedup.append(rounded)
    if dedup and dedup[0] != dedup[-1]:
        dedup.append(list(dedup[0]))
    if len(dedup) < 4:
        return [[round(float(p[0]), precision), round(float(p[1]), precision)] for p in ring]
    return dedup


def generalize_geometry(geometry: dict, precision: int = 4) -> dict:
    """Generaliza as coordenadas de um Polygon ou MultiPolygon para visualização em escala estadual."""
    gtype = geometry.get("type", "")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon":
        geometry["coordinates"] = [generalize_ring(ring, precision) for ring in coords]
    elif gtype == "MultiPolygon":
        geometry["coordinates"] = [
            [generalize_ring(ring, precision) for ring in poly] for poly in coords
        ]
    return geometry


def polygon_centroid(geometry: dict) -> Tuple[float, float]:
    """Calcula o centroide aproximado (lon, lat) de um Polygon ou MultiPolygon."""
    coords = geometry.get("coordinates", [])
    gtype = geometry.get("type", "")
    ring = []
    if gtype == "Polygon" and coords:
        ring = coords[0]
    elif gtype == "MultiPolygon" and coords and coords[0]:
        ring = max(coords, key=lambda poly: len(poly[0]) if poly else 0)[0]
    if not ring:
        return (-44.38, -18.51)
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (round(sum(lons) / len(lons), 4), round(sum(lats) / len(lats), 4))


def ensure_base_geojson() -> dict:
    """
    Garante que o arquivo GeoJSON dos 853 municípios de Minas Gerais exista e esteja
    com generalização cartográfica adequada à escala estadual.
    """
    os.makedirs(os.path.dirname(GEOJSON_PATH), exist_ok=True)

    # Remove o GeoJSON antigo do Paraná se ainda existir
    if os.path.exists(OLD_PR_GEOJSON_PATH):
        try:
            os.remove(OLD_PR_GEOJSON_PATH)
            logging.info("Arquivo antigo %s removido.", OLD_PR_GEOJSON_PATH)
        except OSError:
            pass

    if os.path.exists(GEOJSON_PATH):
        try:
            with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("type") == "FeatureCollection" and len(data.get("features", [])) == 853:
                logging.info("GeoJSON base de Minas Gerais encontrado em %s (853 municípios).", GEOJSON_PATH)
                for feat in data["features"]:
                    props = feat.setdefault("properties", {})
                    if "lat" not in props or "lon" not in props:
                        lon, lat = polygon_centroid(feat.get("geometry", {}))
                        props["lat"] = lat
                        props["lon"] = lon
                return data
        except Exception as exc:
            logging.warning("Falha ao ler GeoJSON existente (%s). Baixando novamente...", exc)

    logging.info("Baixando lista de 853 municípios de Minas Gerais na API do IBGE...")
    resp_mun = requests.get(IBGE_MUNICIPIOS_URL, timeout=30)
    resp_mun.raise_for_status()
    municipios_raw = resp_mun.json()
    nomes_por_codigo = {str(m["id"]): m["nome"] for m in municipios_raw}

    logging.info(
        "Baixando malha municipal de Minas Gerais com generalização estadual (qualidade=minima) na API do IBGE..."
    )
    resp_malha = requests.get(IBGE_MALHA_URL, timeout=60)
    resp_malha.raise_for_status()
    geojson = resp_malha.json()

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for feature in geojson.get("features", []):
        feature["geometry"] = generalize_geometry(feature.get("geometry", {}), precision=4)
        props = feature.setdefault("properties", {})
        cod = str(props.get("codarea", ""))
        lon, lat = polygon_centroid(feature.get("geometry", {}))
        props["cod_ibge"] = cod
        props["nome"] = nomes_por_codigo.get(cod, f"Município {cod}")
        props["lat"] = lat
        props["lon"] = lon
        props.setdefault("temp_atual", None)
        props.setdefault("temp_min", None)
        props.setdefault("temp_max", None)
        props.setdefault("atualizado_em", now_iso)
        props.setdefault("fonte_dados", "Open-Meteo")

    with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

    logging.info("GeoJSON generalizado de Minas Gerais salvo com sucesso em %s.", GEOJSON_PATH)
    return geojson


def fetch_open_meteo_batch(
    batch_idx: int, features_batch: List[dict]
) -> Tuple[int, Dict[str, Dict[str, Optional[float]]]]:
    """
    Consulta a API pública Open-Meteo para um lote de municípios usando suas coordenadas (lat, lon).
    Retorna (batch_idx, {cod_ibge: {"temp_atual": ..., "temp_min": ..., "temp_max": ...}}).
    """
    lats = ",".join(str(f["properties"]["lat"]) for f in features_batch)
    lons = ",".join(str(f["properties"]["lon"]) for f in features_batch)

    params = {
        "latitude": lats,
        "longitude": lons,
        "current": "temperature_2m",
        "daily": "temperature_2m_max,temperature_2m_min",
        "timezone": "America/Sao_Paulo",
        "forecast_days": 1,
    }

    for attempt in range(3):
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
            break
        except Exception as exc:
            if attempt == 2:
                raise
            time.sleep(1.0 * (attempt + 1))

    if isinstance(payload, dict):
        payload = [payload]

    results: Dict[str, Dict[str, Optional[float]]] = {}
    for feat, item in zip(features_batch, payload):
        cod = str(feat["properties"]["cod_ibge"])
        current_block = item.get("current", {})
        daily_block = item.get("daily", {})

        temp_atual = current_block.get("temperature_2m")
        max_list = daily_block.get("temperature_2m_max") or []
        min_list = daily_block.get("temperature_2m_min") or []

        temp_max = max_list[0] if max_list else temp_atual
        temp_min = min_list[0] if min_list else temp_atual

        results[cod] = {
            "temp_atual": round(float(temp_atual), 1) if temp_atual is not None else None,
            "temp_min": round(float(temp_min), 1) if temp_min is not None else None,
            "temp_max": round(float(temp_max), 1) if temp_max is not None else None,
        }

    return batch_idx, results


def update_all_counties(batch_size: int = 80, max_workers: int = 4) -> None:
    """
    Atualiza as temperaturas (atual, mínima e máxima) de todos os 853 municípios de Minas Gerais
    e salva no mesmo arquivo GeoJSON (`data/minas_gerais_municipios.geojson`).
    """
    geojson = ensure_base_geojson()
    features = geojson.get("features", [])
    if not features:
        logging.error("Nenhuma feature encontrada no GeoJSON.")
        return

    logging.info(
        "Coletando temperaturas reais (atual, mínima e máxima) via API pública Open-Meteo para %d municípios de MG...",
        len(features),
    )

    batches = [features[i : i + batch_size] for i in range(0, len(features), batch_size)]
    all_results: Dict[str, Dict[str, Optional[float]]] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(fetch_open_meteo_batch, idx + 1, batch)
            for idx, batch in enumerate(batches)
        ]
        for fut in concurrent.futures.as_completed(futures):
            b_idx, b_res = fut.result()
            all_results.update(b_res)
            logging.info(
                "Lote %d/%d concluído (%d/%d municípios acumulados).",
                b_idx,
                len(batches),
                len(all_results),
                len(features),
            )

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    ok_count = 0

    for feat in features:
        props = feat["properties"]
        cod = str(props["cod_ibge"])
        data = all_results.get(cod)
        props["atualizado_em"] = now_iso
        props["fonte_dados"] = "Open-Meteo API"
        if data and data["temp_atual"] is not None:
            props["temp_atual"] = data["temp_atual"]
            props["temp_min"] = data["temp_min"]
            props["temp_max"] = data["temp_max"]
            props["status_coleta"] = "ok"
            ok_count += 1
        else:
            props["status_coleta"] = "sem_dados"

    atuais = [f["properties"]["temp_atual"] for f in features if f["properties"].get("temp_atual") is not None]
    mins = [f["properties"]["temp_min"] for f in features if f["properties"].get("temp_min") is not None]
    maxs = [f["properties"]["temp_max"] for f in features if f["properties"].get("temp_max") is not None]

    geojson["metadata"] = {
        "estado": "Minas Gerais (MG)",
        "codigo_uf": 31,
        "fonte_geometria": "IBGE - Malha Municipal de Minas Gerais (UF 31) com Generalização Cartográfica Estadual (qualidade=minima, precisão 4 casas decimais)",
        "fonte_meteorologia": "Open-Meteo Weather Forecast API",
        "atualizado_em": now_iso,
        "total_municipios": len(features),
        "municipios_atualizados_com_sucesso": ok_count,
        "status_ultima_coleta": "ok" if ok_count == len(features) else "parcial",
        "resumo_estadual": {
            "temp_atual_min": min(atuais) if atuais else None,
            "temp_atual_max": max(atuais) if atuais else None,
            "temp_min_absoluta": min(mins) if mins else None,
            "temp_max_absoluta": max(maxs) if maxs else None,
        },
    }

    with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

    logging.info(
        "Sucesso! %d/%d municípios de Minas Gerais atualizados no arquivo %s.",
        ok_count,
        len(features),
        GEOJSON_PATH,
    )


if __name__ == "__main__":
    update_all_counties()
