Project: Build a Geographically Grounded 3D Digital Twin of Sangachal Terminal

Objective

Build an interactive, geographically grounded 3D digital twin of Sangachal Terminal, Azerbaijan, including the surrounding landscape, hills, coastline, and visible industrial facility.

Use Three.js to implement the scene.

Do not simply generate an imaginary industrial facility or a generic landscape. First investigate available real-world geographic data, satellite imagery, maps, and public technical documents. Use those sources to reconstruct the environment as accurately as the available data permits.

Your job is to execute the workflow: research the data, acquire usable files, process them, construct the scene, and integrate it into the existing project.

1. Research and acquire source data

Investigate the following sources:

A. Geographic and environmental reference

1. BP Azerbaijan:
    https://www.bp.com/en_az/azerbaijan/home.html
2. BP environmental assessment PDF:
    https://www.bp.com/content/dam/bp/country-sites/en_az/azerbaijan/home/pdfs/esias/acg/acg_pwd_esia_report_final_en.pdf

Inspect the environmental assessment for:

* Topographical maps.
* Site and regional geography.
* Surrounding hills and terrain.
* Coastline and other geographic features.
* Available coordinates, elevations, and distances.
* Figures that can help establish the facility’s geographic context.

Treat this as a historical reference. Do not assume its facility layout reflects current conditions.

B. Digital elevation data

Investigate these sources and determine which offers the most appropriate downloadable elevation data for the site:

3. Copernicus Data Space:
    https://dataspace.copernicus.eu/
4. OpenTopography:
    https://opentopography.org/
5. NASA Earthdata:
    https://www.earthdata.nasa.gov/

Search for available DEM or DSM datasets covering Sangachal Terminal and the surrounding landscape.

Prioritise:

* Geographic coverage of the complete area of interest.
* The highest practical resolution.
* Reliable elevation values.
* Compatible coordinate reference systems.
* Clear licensing and usage permissions.

Prefer a suitable higher-resolution dataset if one is available. Otherwise, use an appropriate global elevation dataset and document its limitations.

C. Satellite imagery and geographic features

6. Google Earth:
    https://earth.google.com/
7. Copernicus Data Space:
    https://dataspace.copernicus.eu/
8. OpenStreetMap:
    https://www.openstreetmap.org/
9. Overpass Turbo:
    https://overpass-turbo.eu/

Investigate available imagery and geographic data for:

* The terminal’s visible footprint.
* Surrounding terrain and hills.
* The Caspian Sea coastline.
* Roads and access routes.
* Large visible industrial structures.
* Buildings, paved areas, and other identifiable features.

Check image resolution and acquisition dates before relying on an image for detailed reconstruction.

Respect each source’s licensing, attribution, and download restrictions. Do not scrape or redistribute imagery in violation of its terms.

D. Existing 3D models and technical documents

Search for publicly downloadable 3D models of Sangachal Terminal and authorised public technical documentation.

Investigate whether any useful assets exist in formats such as:

* GLB / GLTF
* OBJ
* FBX
* IFC
* STEP
* Other usable CAD or BIM formats

Do not assume such assets exist. Verify that a file is actually downloadable and usable before depending on it.

If a complete model is unavailable, continue with procedural reconstruction.

2. Define the geographic area

Identify the terminal’s real-world location and establish a geographic area of interest that includes:

* The entire visible terminal.
* The surrounding hills.
* The Caspian Sea and relevant coastline.
* The nearby terrain needed to understand the landscape context.

Choose the extent based on the site’s geography and the intended viewing scale.

Do not arbitrarily use a large terrain area if doing so would sacrifice useful local detail.

Record the geographic bounds and coordinate reference systems of the downloaded datasets.

3. Construct the terrain from real elevation data

Download and process the best available elevation dataset.

Generate a Three.js terrain mesh using the actual elevation values.

Requirements:

* Preserve real-world horizontal proportions.
* Preserve elevation units and vertical relationships.
* Handle missing or invalid elevation values.
* Transform geographic coordinates into a consistent local coordinate system.
* Avoid unintended terrain distortion.
* Separate the Caspian Sea surface from the terrain.
* Ensure the coastline is visually consistent with the available imagery.
* Generate appropriate terrain normals and materials.

If the selected DEM is too coarse to represent smaller landforms, acknowledge the limitation rather than inventing terrain detail.

Where appropriate, use terrain tiles or levels of detail to maintain performance.

4. Apply geographically aligned imagery

Use a suitable, legally usable satellite or aerial image to texture the terrain.

Ensure the imagery and elevation data are geographically aligned.

Do not stretch an arbitrary image over the terrain without accounting for its geographic bounds and projection.

If a suitable orthophoto cannot be obtained, use the best permitted imagery as a visual reference and create a clearly identified alternative terrain material.

Document the source, resolution, acquisition date, and licensing constraints of the imagery used.

5. Reconstruct Sangachal Terminal

Use available satellite imagery, public documentation, and other permitted visual references to reconstruct the visible industrial facility.

Prioritise the following categories where identifiable in the available sources:

* Major buildings and processing structures.
* Large storage tanks.
* Industrial structures and frameworks.
* Roads and paved areas.
* Pipe racks and visible connecting structures.
* Other major structures that materially define the facility’s appearance.

Use procedural Three.js geometry wherever appropriate.

Create reusable components for repeated objects rather than building every structure independently.

For example:

* Cylinders and roof geometry for tanks.
* Parametric meshes for buildings.
* Curves and extruded geometry for roads.
* Repeated structural elements for pipe racks.
* Polygon meshes for paved surfaces.

Place reconstructed objects using geographic references wherever possible.

Do not fabricate hidden engineering details or claim that inferred dimensions, equipment locations, or piping routes are verified facts.

Distinguish between:

1. Features derived from geographic or technical data.
2. Features reconstructed from visible imagery.
3. Features approximated for visual completeness.

If an exact structure cannot be identified, create a reasonable visual approximation and record that it is approximate.

6. Three.js implementation

Build an interactive 3D scene with the following capabilities:

* Orbit, pan, and zoom.
* A useful initial camera position showing the facility and surrounding landscape.
* Realistic terrain materials and lighting.
* A visible coastline and water surface.
* Appropriate atmospheric and environmental presentation.
* Object selection for major reconstructed structures.
* A clean scene hierarchy separating terrain, water, roads, buildings, and industrial components.
* Efficient rendering for a browser-based application.

Use geographically meaningful coordinates during preprocessing, then convert to a local coordinate system suitable for Three.js rendering.

Avoid using raw latitude and longitude directly as Three.js positions.

Keep the geometry, source data, and metadata organised so the scene can be expanded later.

7. Data-processing workflow

Use appropriate geospatial tools where necessary, such as:

* GDAL
* Rasterio
* GeoPandas
* GeoJSON
* Three.js
* Existing project dependencies

Create a repeatable preprocessing workflow for converting downloaded geographic data into assets that can be loaded by the application.

Prefer compact, browser-friendly outputs over unnecessarily large raw source files.

Retain source metadata, including:

* Dataset name.
* Source URL.
* Acquisition date, where available.
* Spatial resolution.
* Coordinate reference system.
* Units.
* Licensing and attribution.
* Processing steps.
* Known limitations.

Do not silently discard geographic metadata when converting source files.

8. Execution requirements

Work autonomously through the following stages:

1. Inspect the existing codebase and identify its framework, rendering setup, and current project structure.
2. Research the available datasets and verify their usability.
3. Download the most suitable accessible source data.
4. Process the terrain and geographic features.
5. Generate the initial Three.js scene.
6. Reconstruct the main visible facility structures.
7. Integrate the scene into the existing application.
8. Run the application and inspect the result.
9. Fix rendering errors, incorrect coordinate transformations, missing assets, and performance problems.
10. Document how the model was generated and how the data can be updated.

Do not stop after producing a research report or a plan. Proceed to implementation.

If a source requires authentication or a manual download that you cannot perform, identify the precise missing file, provide its official download page, and continue with the other available sources.

Do not invent downloaded files, dataset coverage, coordinates, or research findings.

If a dataset cannot be obtained, use the best available alternative and document the limitation.

9. Deliverables

Produce:

1. An interactive Three.js digital twin of Sangachal Terminal and its surrounding landscape.
2. A terrain mesh derived from real elevation data.
3. A geographically aligned terrain texture, if a suitable source is available.
4. A reconstructed representation of the major visible industrial structures.
5. A clean, modular codebase.
6. The data-processing scripts used to generate the scene.
7. A source manifest identifying every external dataset and its licensing.
8. A README documenting setup, data processing, architecture, and known accuracy limitations.

10. Definition of success

The result should be recognisably based on the real Sangachal Terminal landscape rather than a generic oil and gas facility.

The terrain should represent actual geographic elevation data, the coastline should be geographically plausible, and the major visible facility structures should be positioned according to available evidence.

Prioritise geographic accuracy and a coherent overall site reconstruction over decorative effects.

Start by investigating and verifying the available data. Then acquire it, process it, and build the working Three.js scene.

Do not ask me to manually research the datasets unless you encounter a genuine access restriction. Make reasonable technical decisions independently and continue implementing.