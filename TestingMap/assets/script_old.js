document.addEventListener("DOMContentLoaded", async function () {
    const map = L.map("map").setView([46.3566, 2.3522], 6);
    
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CartoDB",
    }).addTo(map);

    const sqlPromise = initSqlJs({ locateFile: file => `libs/sql-wasm.wasm` });
    const dbPromise = fetch("data/communes.sqlite")
        .then(res => res.arrayBuffer())
        .then(buf => sqlPromise.then(SQL => new SQL.Database(new Uint8Array(buf))));

    const departmentSelect = document.getElementById("department-select");
    const regionSelect = document.getElementById("region-select");
    const libdensSelect = document.getElementById("libdens-select");
    let totalPopulationFrance = 0;

    dbPromise.then(db => {
        // Get total population of France
        totalPopulationFrance = db.exec("SELECT SUM(total_population) FROM communes;")[0].values[0][0];

        // Populate department search bar
        const departments = db.exec("SELECT DISTINCT INSEE_DEP, DEP_NOM FROM communes ORDER BY DEP_NOM;")[0].values;
        departments.forEach(dep => {
            const option = document.createElement("option");
            option.value = dep[0];
            option.textContent = dep[1];
            departmentSelect.appendChild(option);
        });

        // Populate region dropdown
        const regions = db.exec("SELECT DISTINCT INSEE_REG, REG_NOM FROM communes ORDER BY REG_NOM;")[0].values;
        regions.forEach(reg => {
            const option = document.createElement("option");
            option.value = reg[0];
            option.textContent = reg[1];
            regionSelect.appendChild(option);
        });

        // Populate LIBDENS dropdown
        const libdensValues = db.exec("SELECT DISTINCT libdens FROM communes ORDER BY libdens;")[0].values;
        libdensValues.forEach(ld => {
            const option = document.createElement("option");
            option.value = ld[0];
            option.textContent = ld[0];
            libdensSelect.appendChild(option);
        });

        loadMapData(db, "", "", "");
    });

    // function resetFilters() {
    //     departmentSelect.value = "";
    //     regionSelect.value = "";
    // }

    departmentSelect.addEventListener("change", function () {
        // resetFilters();
        dbPromise.then(db => {
            loadMapData(db, departmentSelect.value, "", "");
        });
    });

    regionSelect.addEventListener("change", function () {
        // resetFilters();
        dbPromise.then(db => {
            loadMapData(db, "", regionSelect.value, "");
        });
    });

    libdensSelect.addEventListener("change", function () {
        dbPromise.then(db => {
            loadMapData(db, "", "", libdensSelect.value);
        });
    });



    // Info Control
    const info = L.control();
    info.onAdd = function () {
        this.div = L.DomUtil.create("div", "info");
        this.update();
        return this.div;
    };
    info.update = function (props) {
        this.div.innerHTML = props
            ? `<b>${props.name}</b>
            <br>Nearest ATM: ${props.nearest_ATM}m
            <br>Population: ${props.total_population}`
            : "Hover over a commune";
    };
    info.addTo(map);

    // Legend Control
    const legend = L.control({ position: "bottomright" });
    legend.onAdd = function () {
        const div = L.DomUtil.create("div", "legend"),
              grades = [0, 500, 1000, 2000, 5000];

        div.innerHTML += "<strong>Travel Distance</strong><br>";
        for (let i = 0; i < grades.length; i++) {
            div.innerHTML += `<i style="background:${getColor(grades[i] + 1)}"></i> ${
                grades[i]}${grades[i + 1] ? `–${grades[i + 1]}` : "+"}<br>`;
        }
        return div;
    };
    legend.addTo(map);


    function loadMapData(db, department, region, libdens) {
        map.eachLayer(layer => {
            if (layer instanceof L.GeoJSON) {
                map.removeLayer(layer);
            }
        });

        let query = "SELECT * FROM communes WHERE 1=1";
        if (department) query += ` AND INSEE_DEP = '${department}'`;
        if (region) query += ` AND INSEE_REG = '${region}'`;
        if (libdens) query += ` AND libdens = '${libdens}'`;

        const results = db.exec(query)[0]?.values || [];

        let totalPopulation = 0;
        let weightedDistanceSum = 0;
        let totalHouseholds5km = 0;

        const geoJsonData = {
            type: "FeatureCollection",
            features: results.map(row => {
                const population = row[9] || 0;
                const distance = row[8] || 0;

                totalPopulation += population;
                weightedDistanceSum += population * distance;
                if (distance <= 5000) {
                    totalHouseholds5km += population;
                }

                return {
                    type: "Feature",
                    properties: { name: row[1], nearest_ATM: distance, total_population: population },
                    geometry: JSON.parse(row[4])
                };
            })
        };

        updateStatistics(results.length, totalPopulation, weightedDistanceSum, totalHouseholds5km);

        const geoJsonLayer = L.geoJSON(geoJsonData, {
            // layer.bindTooltip(`<strong>${feature.properties.name}</strong>: ${feature.properties.nearest_ATM}m`);

            onEachFeature: function (feature, layer) {
                layer.on({
                    mouseover: function (e) {
                        e.target.setStyle({ weight: 3, color: "white", fillOpacity: 1 });
                        info.update(feature.properties);
                    },
                    mouseout: function (e) {
                        geoJsonLayer.resetStyle(e.target);
                        info.update();
                    }
                    // click: function (e) {
                    //     map.fitBounds(e.target.getBounds());
                    // }
                });
            },
            style: function (feature) {
                return {
                    fillColor: getColor(feature.properties.nearest_ATM),
                    weight: 0.5,
                    opacity: 0.4,
                    color: "lightgrey",
                    fillOpacity: 0.9
                };
            }
        }).addTo(map);
    }

    
    function updateStatistics(municipalityCount, totalPopulation, weightedDistanceSum, totalHouseholds5km) {
        document.getElementById("num-municipalities").innerHTML = `<span style="font-size: 30px;">${municipalityCount}</span>municipalities`;
        document.getElementById("percentage-households").innerHTML = `<span style="font-size: 30px;">${(totalPopulationFrance > 0 ? ((totalPopulation / totalPopulationFrance) * 100).toFixed(1) : 0)}%</span>of France's population`;
        document.getElementById("avg-distance").innerHTML = `<span style="font-size: 30px;">${(totalPopulation > 0 ? (weightedDistanceSum / totalPopulation).toFixed(0) : 0)}m</span>on average to nearest ATM`;
        document.getElementById("households-5km").innerHTML = `<span style="font-size: 30px;">${(totalPopulation > 0 ? ((totalHouseholds5km / totalPopulation) * 100).toFixed(0) : 0)}%</span>of population within 5 km of an ATM`;
    }

    function getColor(value) {
        return value > 5000 ? "#eff3ff" :
               value > 2000 ? "#bdd7e7" :
               value > 1000 ? "#6baed6" :
               value > 500 ? "#3182bd" :
               "#08519c";
    }

});
