#!/bin/sh
# Fetch brand candidates from Wikidata (SPARQL) into data/raw/wikidata_brands/.
# One query per class (a combined query hits the 60 s limit).
# We keep the ru label, ru aliases (they sometimes contain Cyrillic spellings) and the number
# of Wikipedia articles (sitelinks) as a proxy for popularity.
set -e
cd "$(dirname "$0")/../.."
OUT=data/raw/wikidata_brands
mkdir -p "$OUT"
# brand, automobile manufacturer, airline, bank, retail chain, technology company,
# public company, business, enterprise, trademark, conglomerate, restaurant chain,
# supermarket chain, fast-food chain, car brand, clothing brand
for cls in Q431289 Q786820 Q46970 Q22687 Q507619 Q18388277 Q891723 Q4830453 Q6881511 Q167270 \
           Q778575 Q18509232 Q1631129 Q1751428 Q17087299 Q3477381; do
  [ -s "$OUT/r_$cls.tsv" ] && continue
  q="SELECT ?item ?label ?links (GROUP_CONCAT(DISTINCT ?alias; separator=\"|\") AS ?aliases) ?clsLabel WHERE {
  ?item wdt:P31 wd:$cls . ?item wikibase:sitelinks ?links . FILTER(?links >= 15)
  ?item rdfs:label ?label FILTER(LANG(?label) = \"ru\")
  OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias) = \"ru\") }
  wd:$cls rdfs:label ?clsLabel FILTER(LANG(?clsLabel) = \"en\")
} GROUP BY ?item ?label ?links ?clsLabel"
  curl -s --max-time 75 -G https://query.wikidata.org/sparql --data-urlencode "query=$q" \
    -H 'Accept: text/tab-separated-values' -H 'User-Agent: bitphrase-data/0.1 (dictionary research)' \
    -o "$OUT/r_$cls.tsv" || true
  echo "$cls: $(wc -l < "$OUT/r_$cls.tsv") rows"
  sleep 2
done
