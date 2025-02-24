document.addEventListener("DOMContentLoaded", async function () {
    const map = L.map("map").setView([46.3566, 2.3522], 6);
    
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CartoDB",
    }).addTo(map);

    const sqlPromise = initSqlJs({ locateFile: file => `libs/sql-wasm.wasm` });
    const dbPromise = fetch("data/communes_2024.sqlite")
        .then(res => res.arrayBuffer())
        .then(buf => sqlPromise.then(SQL => new SQL.Database(new Uint8Array(buf))));
    let totalPopulationFrance = 0;


    dbPromise.then(db => {
        totalPopulationFrance = db.exec("SELECT SUM(total_population) FROM communes;")[0].values[0][0];
        // Populate department dropdown
        const departments = db.exec("SELECT DISTINCT INSEE_DEP, DEP_NOM FROM communes ORDER BY DEP_NOM;")[0].values;
        const departmentDropdown = document.getElementById("department-select");
        departments.forEach(dep => {
            const listItem = document.createElement("li");
            listItem.innerHTML = `<a class="dropdown-item" href="#" data-value="${dep[0]}">${dep[1]}</a>`;
            listItem.addEventListener("click", () => {
                document.getElementById("departmentDropdown").textContent = dep[1];
                document.getElementById("regionDropdown").textContent = "Default";
                document.getElementById("libdensDropdown").textContent = "Default";
                loadMapData(db, dep[0], "", "");
                loadFigure1(db, dep[0], "", "");
                loadFigure2(db, dep[0], "", "");
            });
            departmentDropdown.appendChild(listItem);
        });
    
        // Populate region dropdown
        const regions = db.exec("SELECT DISTINCT INSEE_REG, REG_NOM FROM communes ORDER BY REG_NOM;")[0].values;
        const regionDropdown = document.getElementById("region-select");
        regions.forEach(reg => {
            const listItem = document.createElement("li");
            listItem.innerHTML = `<a class="dropdown-item" href="#" data-value="${reg[0]}">${reg[1]}</a>`;
            listItem.addEventListener("click", () => {
                document.getElementById("departmentDropdown").textContent = "Default";
                document.getElementById("regionDropdown").textContent = reg[1];
                document.getElementById("libdensDropdown").textContent = "Default";
                loadMapData(db, "", reg[0], "");
                loadFigure1(db, "", reg[0], "");
                loadFigure2(db, "", reg[0], "");
            });
            regionDropdown.appendChild(listItem);
        });

        const order = [
            "Cities",
            "Dense towns",
            "Semi-dense towns",
            "Suburban areas",
            "Villages",
            "Dispersed rural areas",
            "Mostly unhabitated areas"
        ];
    
        // Populate LIBDENS dropdown
        const libdensValues = db.exec(`
            SELECT DISTINCT libdens 
            FROM communes 
            ORDER BY CASE 
                WHEN libdens = 'Cities' THEN 1
                WHEN libdens = 'Dense towns' THEN 2
                WHEN libdens = 'Semi-dense towns' THEN 3
                WHEN libdens = 'Suburban areas' THEN 4
                WHEN libdens = 'Villages' THEN 5
                WHEN libdens = 'Dispersed rural areas' THEN 6
                WHEN libdens = 'Mostly unhabitated areas' THEN 7
                ELSE 8 -- Default fallback
            END;
        `)[0].values;        
        libdensValues.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        console.log(libdensValues);
        const libdensDropdown = document.getElementById("libdens-select");
        libdensValues.forEach(ld => {
            const listItem = document.createElement("li");
            listItem.innerHTML = `<a class="dropdown-item" href="#" data-value="${ld[0]}">${ld[0]}</a>`;
            listItem.addEventListener("click", () => {
                document.getElementById("departmentDropdown").textContent = "Default";
                document.getElementById("regionDropdown").textContent =  "Default";
                document.getElementById("libdensDropdown").textContent = ld[0];
                loadMapData(db, "", "", ld[0]);
                loadFigure1(db, "", "", ld[0]);
                loadFigure2(db, "", "", ld[0]);
            });
            libdensDropdown.appendChild(listItem);
        });

        loadMapData(db, "", "", "");
        loadFigure1(db, "", "", "");
        loadFigure2(db, "", "", "");
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
            ? `<h6>${props.name}</h6>
            <br>Average distance to
            nearest ATM: ${props.nearest_ATM}m`
            // <br>Population: ${props.total_population}
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

    document.getElementById("map-btn").addEventListener("click", function() {
        showContent("map-content");
    });
    
    document.getElementById("summary-btn").addEventListener("click", function() {
        showContent("summary-content");
    });
    
    document.getElementById("conclusion-btn").addEventListener("click", function() {
        showContent("conclusion-content");
    });
    
    function showContent(contentId) {
        document.getElementById("map-content").style.display = "none";
        document.getElementById("summary-content").style.display = "none";
        document.getElementById("conclusion-content").style.display = "none";
    
        document.getElementById(contentId).style.display = "flex";
    }
    

    function loadFigure1(db, department, region, libdens) {
        const totalPopulationFrance = db.exec("SELECT SUM(total_population) FROM communes;")[0].values[0][0];
    
        const totalSelectionQuery = `
            SELECT SUM(total_population) FROM communes WHERE 1=1
            ${department ? ` AND INSEE_DEP = '${department}'` : ""}
            ${region ? ` AND INSEE_REG = '${region}'` : ""}
            ${libdens ? ` AND libdens = '${libdens}'` : ""}
        `;
        const totalPopulationSelection = db.exec(totalSelectionQuery)[0].values[0][0] || 1; // Avoid division by 0
    
        const bins = [];
        for (let i = 0; i < 10000; i += 500) {
            bins.push(`${i}-${i + 500}`);
        }
    
        const customXTicks = {
            "1500-2000": "1500-2000",
            "3500-4000": "3500-4000",
            "5500-6000": "5500-6000",
            "7500-8000": "7500-8000",
            "9500-10000": "9500-10000"
        };
    
        function getCategory(distance) {
            if (distance > 10000) return "10000m+";
            return `${Math.floor(distance / 500) * 500}-${Math.floor(distance / 500) * 500 + 500}`;
        }
    
        const query = `
            SELECT 
                SUM(total_population) AS population, 
                CASE 
                    ${bins.map((range, i) => `WHEN nearest_ATM BETWEEN ${i * 500} AND ${(i + 1) * 500} THEN '${range}'`).join("\n")}
                    ELSE '10000m+'
                END AS distance_category
            FROM communes 
            GROUP BY distance_category
            ORDER BY distance_category;
        `;
    
        const franceData = db.exec(query)[0].values.reduce((acc, row) => {
            acc[row[1]] = (row[0] / totalPopulationFrance) * 100;
            return acc;
        }, {});


    
        let selectionQuery = `
            SELECT 
                SUM(total_population) AS population, 
                CASE 
                    WHEN nearest_ATM BETWEEN 0 AND 500 THEN '0-500'
                    WHEN nearest_ATM BETWEEN 500 AND 1000 THEN '500-1000'
                    WHEN nearest_ATM BETWEEN 1000 AND 1500 THEN '1000-1500'
                    WHEN nearest_ATM BETWEEN 1500 AND 2000 THEN '1500-2000'
                    WHEN nearest_ATM BETWEEN 2000 AND 2500 THEN '2000-2500'
                    WHEN nearest_ATM BETWEEN 2500 AND 3000 THEN '2500-3000'
                    WHEN nearest_ATM BETWEEN 3000 AND 3500 THEN '3000-3500'
                    WHEN nearest_ATM BETWEEN 3500 AND 4000 THEN '3500-4000'
                    WHEN nearest_ATM BETWEEN 4000 AND 4500 THEN '4000-4500'
                    WHEN nearest_ATM BETWEEN 4500 AND 5000 THEN '4500-5000'
                    WHEN nearest_ATM BETWEEN 5000 AND 5500 THEN '5000-5500'
                    WHEN nearest_ATM BETWEEN 5500 AND 6000 THEN '5500-6000'
                    WHEN nearest_ATM BETWEEN 6000 AND 6500 THEN '6000-6500'
                    WHEN nearest_ATM BETWEEN 6500 AND 7000 THEN '6500-7000'
                    WHEN nearest_ATM BETWEEN 7000 AND 7500 THEN '7000-7500'
                    WHEN nearest_ATM BETWEEN 7500 AND 8000 THEN '7500-8000'
                    WHEN nearest_ATM BETWEEN 8000 AND 8500 THEN '8000-8500'
                    WHEN nearest_ATM BETWEEN 8500 AND 9000 THEN '8500-9000'
                    WHEN nearest_ATM BETWEEN 9000 AND 9500 THEN '9000-9500'
                    WHEN nearest_ATM BETWEEN 9500 AND 10000 THEN '9500-10000'
                    ELSE '10000m+'
                END AS distance_category
            FROM communes 
            WHERE 1=1 `;  // Base condition to append more filters dynamically

        // Dynamically append filters
        if (department) selectionQuery += ` AND INSEE_DEP = '${department}'`;
        if (region) selectionQuery += ` AND INSEE_REG = '${region}'`;
        if (libdens) selectionQuery += ` AND libdens = '${libdens}'`;

        // Add GROUP BY and ORDER BY at the end
        selectionQuery += ` GROUP BY distance_category ORDER BY distance_category;`;

        const selectionData = db.exec(selectionQuery)[0].values.reduce((acc, row) => {
            acc[row[1]] = (row[0] / totalPopulationSelection) * 100;
            return acc;
        }, {});
    
        const categories = bins.concat(["10000m+"]);
        const francePercentages = categories.map(cat => (franceData[cat] || 0));
        const selectionPercentages = categories.map(cat => (selectionData[cat] || 0));

    
        const traceFrance = {
            x: categories.map(cat => customXTicks[cat] !== undefined ? customXTicks[cat] : cat), // Apply custom x-ticks
            y: francePercentages,
            name: "France",
            type: "bar",
            marker: { color: "#08519c" },
            hovertemplate: "%{y:.1f}%" // Custom hover format
        };

        const traceSelection = {
            x: categories.map(cat => customXTicks[cat] !== undefined ? customXTicks[cat] : cat),
            y: selectionPercentages,
            name: "Selection",
            type: "bar",
            marker: { color: "#bdd7e7" },
            hovertemplate: "%{y:.1f}%"
        };
    
        const layout = {
            margin: { l: 40, r: 20, t: 20, b: 40 }, // Minimize margin
            // title: "Share of Households by Travel Distance to Nearest ATM (in m)",
            xaxis: { title: "Travel Distance to ATM (in m)", tickvals: Object.values(customXTicks), ticktext: Object.values(customXTicks) },
            yaxis: { title: "Share of population", dtick: 10 }, // Show only multiples of 10
            barmode: "group",
            width: 600,  // Max figure size
            height: 400,
            hovermode: "x unified", // Custom hover mode
            showlegend: true,
            legend: { x: 1, y: 1, xanchor: "right", yanchor: "top" } // Legend inside plot (upper right)
        };
    
        Plotly.newPlot("fig1", [traceFrance, traceSelection], layout, { displayModeBar: false }); // Remove default actions
    }
    


    function loadFigure2(db, department, region, libdens) {
        const totalPopulationFrance = db.exec("SELECT SUM(total_population) FROM communes;")[0].values[0][0];

        const order = [
            "Cities",
            "Dense towns",
            "Semi-dense towns",
            "Suburban areas",
            "Villages",
            "Dispersed rural areas",
            "Mostly unhabitated areas"
        ];


        let query = `
            SELECT 
                libdens, 
                SUM(CASE WHEN nearest_ATM <= 500 THEN total_population ELSE 0 END) AS "0-500m",
                SUM(CASE WHEN nearest_ATM > 500 AND nearest_ATM <= 1000 THEN total_population ELSE 0 END) AS "500-1000m",
                SUM(CASE WHEN nearest_ATM > 1000 AND nearest_ATM <= 2000 THEN total_population ELSE 0 END) AS "1000-2000m",
                SUM(CASE WHEN nearest_ATM > 2000 AND nearest_ATM <= 5000 THEN total_population ELSE 0 END) AS "2000-5000m",
                SUM(CASE WHEN nearest_ATM > 5000 THEN total_population ELSE 0 END) AS "5000m+",
                SUM(total_population) AS total_population
            FROM communes WHERE 1=1
            ${department ? ` AND INSEE_DEP = '${department}'` : ""}
            ${region ? ` AND INSEE_REG = '${region}'` : ""}
            ${libdens ? ` AND libdens = '${libdens}'` : ""}
            GROUP BY libdens
        `;
    
        const result = db.exec(query)[0].values;
    
        const labels = order.filter(label => result.some(row => row[0] === label));
        const categories = ["0-500m", "500-1000m", "1000-2000m", "2000-5000m", "5000m+"];
    
        const values = categories.map((_, i) => labels.map(label => (result.find(row => row[0] === label)[i + 1] / result.find(row => row[0] === label)[6]) * 100));

        const customColors = ["#08519c", "#3182bd", "#6baed6", "#bdd7e7", "#eff3ff"];

        const traces = categories.map((category, i) => ({
            x: values[i],
            y: labels,
            name: category,
            type: "bar",
            orientation: "h",
            marker: { color: customColors[i] },
            width: 0.5 // Set max bar width
        }));
    
        const layout = {
            // title: "Share of Households by Travel Distance to Nearest ATM (in m)",
            xaxis: { title: "Share of population", range: [0, 100], tickformat: ".1f%" },
            yaxis: { 
                // title: "Types of Municipalities",
                categoryorder: "array", 
                categoryarray: order,
                automargin: true // Ensures y-axis labels are not cut off
            },
            legend: {
                x: -0.1, y: -0.2,  // Move legend closer to the y-axis
                xanchor: "left", yanchor: "top",
                orientation: "h",  // Keep it horizontal
                font: { size: 10 }  // Reduce font size
            },
            barmode: "stack",
            width: 600,
            height: 400,
            margin: { l: 40, r: 20, t: 20, b: 40 }, // Minimize margin
        };
    
        Plotly.newPlot("fig2", traces, layout, { displayModeBar: false }); // Remove actions
    }



});
