#!/bin/sh
# Download the English sources into data/en/raw/ (about 0.6 GB). Run once before build_all.sh.
set -e
RAW="$(dirname "$0")/../../../data/en/raw"
mkdir -p "$RAW"
cd "$RAW"
mkdir -p wiktionary_kaikki wordnet names_ssa surnames_census geonames freq_opensubtitles cmudict
curl -fsSL -o wiktionary_kaikki/kaikki.org-dictionary-English.jsonl.gz https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
curl -fsSL -o wordnet/wn3.1.dict.tar.gz https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz && (cd wordnet && tar xzf wn3.1.dict.tar.gz)
# ssa.gov blocks scripted downloads; the same SSA data (top 1000 names per year, 1880–2008):
curl -fsSL -o names_ssa/baby-names.csv https://raw.githubusercontent.com/hadley/data-baby-names/master/baby-names.csv
curl -fsSL -o surnames_census/names.zip https://www2.census.gov/topics/genealogy/2010surnames/names.zip && (cd surnames_census && unzip -oq names.zip)
curl -fsSL -o geonames/cities15000.zip https://download.geonames.org/export/dump/cities15000.zip && (cd geonames && unzip -oq cities15000.zip)
curl -fsSL -o geonames/countryInfo.txt https://download.geonames.org/export/dump/countryInfo.txt
curl -fsSL -o freq_opensubtitles/en_full.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt
curl -fsSL -o cmudict/cmudict.dict https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
curl -fsSL -o cmudict/LICENSE https://raw.githubusercontent.com/cmusphinx/cmudict/master/LICENSE
