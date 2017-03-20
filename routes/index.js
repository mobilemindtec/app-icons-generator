var express = require('express');
var router = express.Router();
var fs = require('fs');
var sharp = require("sharp")
var logger = require('winston');
var uuid = require('node-uuid');
var zip = new require('node-zip')();
var multer  = require('multer')
var sizeOf = require('image-size');
var settings = require("../settings")

var icons_default_size = settings.icons_default_size
var temp_path = settings.upload_path
var upload = multer({ dest: `${temp_path}/` });


router.get('/', function(req, res, next) {
  res.render('index', { icons_default_size: icons_default_size });
});

router.get('/upload/:action', function(req, res, next) {
  res.redirect("/")
});

router.post('/upload/custom', upload.array('files'), function(req, res, next){
    logRequestInfo(req)
    process(req, res, icons_default_size.custon_icons, { custom_icons: true })
})

router.post('/upload/launcher', function(req, res, next){

    upload.single('files')(req, res, function(error){

        if(error){
            res.render('index', { error: true, message: `Error on process request: ${error}. Only one file is required` });
            return
        }

        logRequestInfo(req)
        process(req, res, icons_default_size.launcher_icons, { launcher: true })        
    })
})

router.post('/upload/actionbar', upload.array('files'), function(req, res, next){
    logRequestInfo(req)
    process(req, res, icons_default_size.launcher_icons)
})


router.post('/upload/tab', upload.array('files'), function(req, res, next){
    logRequestInfo(req)
    process(req, res, icons_default_size.tab_icons)
})

router.post('/upload/listview', upload.array('files'), function(req, res, next){
    logRequestInfo(req)
    process(req, res, icons_default_size.listview_icons)
})

// only android
router.post('/upload/menu', upload.array('files'), function(req, res, next){
    logRequestInfo(req)
    process(req, res, icons_default_size.menu_icons)
})

// only android
router.post('/upload/statusbar', upload.array('files'), function(req, res, next){
    logRequestInfo(req)
    process(req, res, icons_default_size.statusbar_icons)
})

// only android
router.post('/upload/dialogs', upload.array('files'), function(req, res, next){
    logRequestInfo(req)
    process(req, res, icons_default_size.dialogs_icons)
})


function process(req, res, type_icons, params){

    params = params || {}

    var request_temp_path = `${temp_path}/${uuid.v4()}`
    var request_temp_path_android = `${request_temp_path}/android`
    var request_temp_path_ios = `${request_temp_path}/ios`

    fs.mkdirSync(request_temp_path)
    fs.mkdirSync(request_temp_path_android)
    fs.mkdirSync(request_temp_path_ios)


    var icons_to_create = []


    for(var i in req.files){

        var uploaded_file = req.files[i]
        var original_file_full_path = uploaded_file.path

        logger.info(`create icons to ${uploaded_file.originalname}`);

        var original_file_dimensions = sizeOf(original_file_full_path)

        for(var platform in type_icons){

            for(var platform_size_name in type_icons[platform]){
                
                var resizeTo = type_icons[platform][platform_size_name]

                // to custon icons calcula size based at less image
                if(params.custom_icons){

                    var iosSize = getInt(req.body.iosSize)
                    var androidSize = getInt(req.body.androidSize)
                    

                    if(platform == 'ios'){  

                        if(iosSize > 0)
                            resizeTo = iosSize

                        switch(platform_size_name){
                            case "@2x":
                            resizeTo *= 2
                            break
                            case "@3x":
                            resizeTo *= 3
                            break
                        }

                    }else{

                        if(androidSize > 0)
                            resizeTo = androidSize
                        else if(original_file_dimensions.width > original_file_dimensions.height)
                            resizeTo = original_file_dimensions.width
                        else
                            resizeTo = original_file_dimensions.height

                        resizeTo = resizeTo * getMultBaseMdpi(platform_size_name) 

                    }
                }

                var clear_filename = sanitizeResourceName(uploaded_file.originalname.split(".")[0])

                if(params.launcher){
                    if(platform == 'ios'){
                        clear_filename = ""
                    }else{
                        clear_filename = "icon"
                    }
                }

                var destination_file
                
                if(platform == 'ios'){  
                    destination_file = `${request_temp_path_ios}/${clear_filename}${platform_size_name}.png`
                }else{
                    var android_sub_path = `${request_temp_path_android}/drawable-${platform_size_name}`
                    
                    if(!fs.existsSync(android_sub_path))
                        fs.mkdirSync(android_sub_path)

                    destination_file = `${android_sub_path}/${clear_filename}.png`                            
                }
                

                icons_to_create.push({
                    original_file: original_file_full_path, 
                    destination_file: destination_file,
                    resizeTo: resizeTo
                })
            }
        }
    }

    var next = function(){

        if(icons_to_create.length == 0){
            var zip_file = createIconsZip(request_temp_path)
            res.download(zip_file)
            return
        }

        var item = icons_to_create.pop()

        logger.info(`create icon ${item.destination_file}`)

        createIcon(item.original_file, item.destination_file, item.resizeTo).then(function(){
            next()
        }).catch(function(error){
            res.render('index', { error: true, message: `Error on process request: ${error}` });
        })
    }

    next()    
}

function createIcon(origin_file, destination_file, resizeTo){

    return new Promise(function(resolve, reject){

        sharp(origin_file)              
          .resize(resizeTo)
          .toBuffer()
          .then(function(buff){

            var fd = fs.openSync(destination_file, 'w')

            fs.write(fd, buff, 0, buff.length, 0, function(err,written){            

                if(err){
                    logger.error(`error on create icon: ${error}`)
                    reject(error)                    
                }else{
                    resolve()
                }
            });                        
            
          }).catch(function(error){
            logger.error(`error on create icon: ${error}`)
            reject(error)
          })

    })
}

function createIconsZip(icons_folder){
    
    var sp = icons_folder.split("/")
    var zip_path = `${icons_folder}.zip`
    var base_folder_name = sp[sp.length = 1]

    var items = readAllFiles(icons_folder)
    
    var zip_base_folder = zip.folder(base_folder_name)    

    for(var i in items){
        var item = items[i]

        if(item.files){
            var zip_current_folder = zip_base_folder.folder(item.filename)
            addZipSubFiles(item.files, zip_current_folder)
        }else{
            zip_base_folder.file(item.filename, fs.readFileSync(item.full_path));            
        }

    }
    
    var data = zip.generate({ base64: false, compression:'DEFLATE' });
    fs.writeFileSync(zip_path, data, 'binary');

    return zip_path
}

function addZipSubFiles(files, zip){

    for(var i in files){
        var item = files[i]

        if(item.files){
            var zip_current_folder = zip.folder(item.filename)
            addZipSubFiles(item.files, zip_current_folder)
        }else{
            zip.file(item.filename, fs.readFileSync(item.full_path))
        }
    }
}

function readAllFiles(dir){
    
    var items =  [];

    var files = fs.readdirSync(dir);

    for (var i in files){
        var filename = files[i]
        var full_path = dir + '/' + files[i];

        var isDirectory = fs.statSync(full_path).isDirectory()

        items.push({
            filename: filename,
            full_path: full_path,                            
            files: isDirectory ? readAllFiles(full_path) : undefined
        });
    }

    return items;
}

function logRequestInfo(req){
    var length = 0

    for(var i in req.files){
        length += req.files[i].size
    }

    logger.info(`{ host: ${req.headers.host}, time: ${new Date().toISOString()}, action: '/upload/custom', files: ${req.files.length}, len: ${length} }`)    
}

function sanitizeResourceName(s) {
    return s.toLowerCase().replace(/[\s-\.]/g, '_').replace(/[^\w_]/g, '')
}


// from https://github.com/romannurik/AndroidAssetStudio
// https://github.com/romannurik/AndroidAssetStudio/blob/master/app/scripts/pages/GenericIconGenerator.js
function getMultBaseMdpi(density) {
    switch (density) {
      case 'xxxhdpi': return 4.00;
      case  'xxhdpi': return 3.00;
      case   'xhdpi': return 2.00;
      case    'hdpi': return 1.50;
      case   'tvdpi': return 1.33125;
      case    'mdpi': return 1.00;
      case    'ldpi': return 0.75;
    }
    return 1.0;
}

function getDpiForDensity(density) {
    switch (density) {
      case 'xxxhdpi': return 640;
      case  'xxhdpi': return 480;
      case   'xhdpi': return 320;
      case    'hdpi': return 240;
      case   'tvdpi': return 213;
      case    'mdpi': return 160;
      case    'ldpi': return 120;
    }
    return 160;
}

function getInt(value){

    try{

        var val = parseInt(value)

        if(val > 0)
            return val

    }catch(err){

    }

    return 0
}

module.exports = router;
