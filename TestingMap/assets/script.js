document.addEventListener("DOMContentLoaded", async function () {
    const map = L.map("map").setView([46.8566, 2.3522], 6);
    
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CartoDB",
    }).addTo(map);

    const sqlPromise = initSqlJs({ locateFile: file => `libs/sql-wasm.wasm` });
    const dbPromise = fetch("data/communes.sqlite")
        .then(res => res.arrayBuffer())
        .then(buf => sqlPromise.then(SQL => new SQL.Database(new Uint8Array(buf))));

    const departmentSelect = document.getElementById("department-select");

    dbPromise.then(db => {
        // Populate the department select
        const departments = db.exec("SELECT DISTINCT INSEE_DEP FROM communes ORDER BY INSEE_DEP;")[0].values;
        departments.forEach(dep => {
            const option = document.createElement("option");
            option.value = dep[0];
            option.textContent = `Department ${dep[0]}`;
            departmentSelect.appendChild(option);
        });

        // Load the initial map data
        loadMapData(db, "");
    });

    departmentSelect.addEventListener("change", function () {
        dbPromise.then(db => {
            loadMapData(db, departmentSelect.value);
        });
    });

    function loadMapData(db, department) {
        map.eachLayer(layer => {
            if (layer instanceof L.GeoJSON) {
                map.removeLayer(layer);
            }
        });

        let query = "SELECT INSEE_COM, NOM, INSEE_DEP, INSEE_REG, AsGeoJSON(geometry) AS geometry, nearest_ATM, total_population FROM communes";
        if (department) {
            query += ` WHERE INSEE_DEP = '${department}'`;
        }

        const results = db.exec(query)[0].values;

        const geoJsonData = {
            type: "FeatureCollection",
            features: results.map(row => ({
                type: "Feature",
                properties: {
                    name: row[1],  // "NOM"
                    nearest_ATM: row[5]  // "nearest_ATM"
                },
                geometry: JSON.parse(row[4])  // "geometry" (GeoJSON format)
            }))
        };

        L.geoJSON(geoJsonData, {
            style: feature => ({
                fillColor: getColor(feature.properties.nearest_ATM),
                weight: 2,
                opacity: 1,
                color: "white",
                fillOpacity: 0.7
            }),
            onEachFeature: (feature, layer) => {
                layer.bindTooltip(`<strong>${feature.properties.name}</strong><br>Nearest ATM: ${feature.properties.nearest_ATM}m`);
            }
        }).addTo(map);
    }

    function getColor(value) {
        return value > 7000 ? "#800026" :
               value > 5000 ? "#BD0026" :
               value > 3000 ? "#E31A1C" :
               value > 1500 ? "#FC4E2A" :
               value > 1000 ? "#FD8D3C" :
               value > 500 ? "#FEB24C" :
               "#FFEDA0";
    }
});
